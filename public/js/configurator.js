// Клиентский модуль интерактивного конфигуратора домов и бань (public/js/configurator.js).
// Управляет выбором параметров: серия -> размер -> цвет фасада -> крыльцо/терраса (открытая/закрытая).
// Загружает реальные фотографии проекта из каталога с динамическим каскадным подбором,
// пересчитывает общую смету на лету и отправляет готовую комплектацию в корзину или форму заявки.

const Configurator = (function () {
  "use strict";

  const COLOR_ORDER = ["bronze", "beige", "graphite"];
  const COLOR_LABELS = { bronze: "Бронза", beige: "Бежевый", graphite: "Графит" };
  const COLOR_VALUES = { bronze: "#76523b", beige: "#c7b994", graphite: "#343a3b" };
  const ENTRANCE_LABELS = { porch: "Крыльцо", terrace: "Терраса" };
  const TERRACE_LABELS = { covered: "Крытая", open: "Открытая" };
  const TERRACE_SUMMARY_LABELS = { covered: "Крытая терраса", open: "Открытая терраса" };
  const KIND_LABELS = {
    exterior: "вид снаружи",
    plan: "планировка",
    interior: "интерьер",
    real: "реальная фотография",
    detail: "деталь проекта",
    image: "фотография проекта"
  };
  const ALLOWED_IMAGE = /\.(?:jpe?g|png|webp)$/i;
  const PRICED_DIMENSION_PATTERN = /^(?:(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)(?:m2|sqm))(?:__p(\d+))?$/i;

  let state = {
    seriesSlug: "altai",
    seriesName: "Алтай",
    typeName: "Дом",
    categorySlug: "houses",
    seriesPath: "houses/altai",
    houseKey: "",
    color: "bronze",
    entrance: null,
    terraceType: null,
    extensionKey: null,
    houseChoices: [],
    extensionChoices: [],
    availableColors: [],
    availableEntrances: [],
    availableTerraceTypes: [],
    currentHouse: null,
    currentExtension: null,
    slides: [],
    slideIndex: 0,
    request: 0,
    controller: null,
    loading: true
  };

  let root = null;
  let elements = {};
  let mediaProvider = createLocalProvider();

  function query(selector) {
    return root ? root.querySelector(selector) : null;
  }

  function createLocalProvider() {
    const cache = new Map();
    return {
      list: async function (folderPath, signal) {
        const clean = String(folderPath || "").replace(/^[\/\\]+|[\/\\]+$/g, "");
        if (cache.has(clean)) return cache.get(clean);
        const url = '/api/media/list?path=' + encodeURIComponent(clean);
        const response = await fetch(url, { method: "GET", credentials: "omit", signal });
        if (response.status === 404) {
          cache.set(clean, []);
          return [];
        }
        if (!response.ok) throw new Error("Local Media HTTP " + response.status);
        const items = await response.json();
        cache.set(clean, Array.isArray(items) ? items : []);
        return items;
      },
      clearCache: function () { cache.clear(); }
    };
  }

  function createYandexDiskProvider(mediaConfig) {
    const endpoint = "https://cloud-api.yandex.net/v1/disk/public/resources";
    const cache = new Map();
    const publicKey = String(mediaConfig.publicKey || "").trim();
    const configured = publicKey && publicKey.indexOf("PASTE_PUBLIC_") !== 0;
    return {
      list: async function (folderPath, signal) {
        if (!configured) throw new Error("Yandex Disk is not configured");
        const clean = String(folderPath || "").replace(/^[\/\\]+|[\/\\]+$/g, "");
        if (cache.has(clean)) return cache.get(clean);
        const allItems = [];
        let offset = 0;
        let total = Infinity;
        const pageSize = 200;
        while (offset < total) {
          const url = new URL(endpoint);
          url.searchParams.set("public_key", publicKey);
          url.searchParams.set("path", "/" + clean);
          url.searchParams.set("limit", String(pageSize));
          url.searchParams.set("offset", String(offset));
          url.searchParams.set("preview_size", "L");
          url.searchParams.set("preview_crop", "false");
          const response = await fetch(url.toString(), { method: "GET", credentials: "omit", signal });
          if (response.status === 404) {
            cache.set(clean, []);
            return [];
          }
          if (!response.ok) throw new Error("Yandex Disk HTTP " + response.status);
          const payload = await response.json();
          const embedded = payload && payload._embedded ? payload._embedded : { items: [], total: 0 };
          const items = Array.isArray(embedded.items) ? embedded.items : [];
          total = Number.isFinite(Number(embedded.total)) ? Number(embedded.total) : offset + items.length;
          allItems.push(...items);
          offset += items.length;
          if (!items.length || items.length < pageSize) break;
        }
        cache.set(clean, allItems);
        return allItems;
      },
      clearCache: function () { cache.clear(); }
    };
  }

  function canonicalNumber(value) { return Number(value).toString(); }
  function displayNumber(value) { return canonicalNumber(value).replace(".", ","); }

  function parsePricedDimensionFolder(name) {
    const match = String(name || "").match(PRICED_DIMENSION_PATTERN);
    if (!match) return null;
    const price = match[4] == null ? null : Number(match[4]);
    if (price != null && !Number.isFinite(price)) return null;

    if (match[1] != null && match[2] != null) {
      const width = Number(match[1]);
      const length = Number(match[2]);
      if (!Number.isFinite(width) || !Number.isFinite(length) || width <= 0 || length <= 0) return null;
      return {
        isArea: false,
        key: canonicalNumber(width) + "x" + canonicalNumber(length),
        label: displayNumber(width) + "×" + displayNumber(length) + " м",
        width,
        length,
        area: Math.round(width * length * 10) / 10,
        price,
        folder: String(name)
      };
    }

    if (match[3] != null) {
      const area = Number(match[3]);
      if (!Number.isFinite(area) || area <= 0) return null;
      return {
        isArea: true,
        key: canonicalNumber(area) + "m2",
        label: displayNumber(area) + " кв.м",
        width: 0,
        length: 0,
        area,
        price,
        folder: String(name)
      };
    }

    return null;
  }

  function compareDimensions(left, right) {
    if (left.isArea && right.isArea) {
      return left.area - right.area || left.key.localeCompare(right.key, "en");
    }
    return left.width - right.width || left.length - right.length || (left.area || 0) - (right.area || 0) || left.key.localeCompare(right.key, "en");
  }

  function directoryItems(items) {
    return Array.isArray(items) ? items.filter(i => i && i.type === "dir") : [];
  }

  function hasDirectory(items, name) {
    const lower = String(name || "").toLowerCase();
    return directoryItems(items).some(i => String(i.name || "").toLowerCase() === lower);
  }

  function buildHouseChoices(diskItems) {
    const choices = new Map();
    directoryItems(diskItems).forEach(item => {
      const parsed = parsePricedDimensionFolder(item.name);
      if (parsed && !choices.has(parsed.key)) {
        choices.set(parsed.key, parsed);
      }
    });
    return Array.from(choices.values()).sort(compareDimensions);
  }

  function buildExtensionChoices(diskItems) {
    const choices = new Map();
    directoryItems(diskItems).forEach(item => {
      const parsed = parsePricedDimensionFolder(item.name);
      if (parsed && !choices.has(parsed.key)) {
        choices.set(parsed.key, parsed);
      }
    });
    return Array.from(choices.values()).sort(compareDimensions);
  }

  function currentHouse() {
    return state.houseChoices.find(c => c.key === state.houseKey) || state.houseChoices[0] || null;
  }

  function currentExtension() {
    return state.extensionChoices.find(c => c.key === state.extensionKey) || null;
  }

  function isCompleteEntrance() {
    return (state.entrance === "porch" && !!state.currentExtension) ||
      (state.entrance === "terrace" && !!state.terraceType && !!state.currentExtension);
  }

  function priceLabel(price) {
    if (price == null || !Number.isFinite(Number(price))) return "Цена на уточнении";
    return formatPrice(price);
  }

  function formatPrice(val) {
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Number(val) || 0) + " ₽";
  }

  function calculateTotalPrice() {
    const house = state.currentHouse;
    let base = house && house.price ? Number(house.price) : 0;
    if (isCompleteEntrance() && state.currentExtension && state.currentExtension.price) {
      const extPrice = Number(state.currentExtension.price);
      if (extPrice < 600000) {
        base += extPrice;
      } else if (extPrice > base) {
        base = extPrice;
      } else {
        base += extPrice;
      }
    }
    return base;
  }

  function projectTitle() {
    const houseLabel = state.currentHouse ? state.currentHouse.label : "";
    const base = (state.typeName || "Проект") + " «" + (state.seriesName || "Алтай") + "»" + (houseLabel ? " " + houseLabel : "");
    if (!isCompleteEntrance()) return base;
    if (state.entrance === "porch") {
      return base + " с крыльцом " + state.currentExtension.label;
    }
    const typeLabel = state.terraceType === "open" ? "открытой" : "крытой";
    return base + " с " + typeLabel + " террасой " + state.currentExtension.label;
  }

  function entranceSummary() {
    if (!state.entrance) return "Без пристроя";
    if (state.entrance === "porch") {
      return state.currentExtension ? "Крыльцо " + state.currentExtension.label : "Крыльцо — выберите размер";
    }
    if (!state.terraceType) return "Терраса — выберите исполнение";
    const label = TERRACE_SUMMARY_LABELS[state.terraceType];
    return state.currentExtension ? label + " " + state.currentExtension.label : label + " — выберите размер";
  }

  function mediaPath(...parts) {
    const list = [];
    parts.forEach(p => {
      String(p || "").split(/[\/\\]/).forEach(seg => {
        const clean = seg.trim();
        if (clean) list.push(clean);
      });
    });
    return list.join("/");
  }

  function mediaItemToSlide(item) {
    const name = String(item.name || "image");
    const meta = mediaFilenameMetadata(name);
    return {
      type: "image",
      name,
      order: meta.order,
      kind: meta.kind,
      url: item.file || item.preview,
      thumbnailUrl: item.preview || item.file,
      referrerPolicy: item.referrerPolicy || "no-referrer"
    };
  }

  function mediaFilenameMetadata(name) {
    const base = String(name).replace(/\.[^.]+$/, "").toLowerCase();
    const keywords = ["main", "exterior", "plan", "interior", "real", "detail"];
    const keyword = keywords.find(candidate => base === candidate || base.indexOf(candidate + "_") === 0);
    const priority = keyword ? keywords.indexOf(keyword) : keywords.length;
    const numberMatch = keyword ? base.slice(keyword.length).match(/^_(\d+)(?:_|$)/) : null;
    const number = numberMatch ? Number(numberMatch[1]) : (keyword === "main" ? 0 : 1);
    return { order: priority * 100000 + number, kind: keyword === "main" ? "exterior" : (keyword || "image") };
  }

  function compareSlides(a, b) {
    return a.order - b.order || String(a.name).localeCompare(String(b.name), "en", { numeric: true, sensitivity: "base" });
  }

  function makePlaceholderSlide(reason) {
    const titles = {
      loading: "Загружаем проект...",
      missing: "Фотографии в обработке",
      error: "Изображение временно недоступно"
    };
    const descrs = {
      loading: "Проверяем доступные ракурсы и планировки.",
      missing: "Для выбранной комплектации фотографии пока не добавлены.",
      error: "Вы можете продолжить выбор и получить подробную консультацию."
    };
    return {
      type: "placeholder",
      name: "placeholder",
      order: 0,
      reason,
      title: titles[reason] || projectTitle(),
      text: descrs[reason] || ""
    };
  }

  function resolveTarget(seriesPath) {
    const house = state.currentHouse;
    if (!house || !house.folder) return { exists: false, path: null, items: [], needsListing: false };
    const housePath = mediaPath(seriesPath, house.folder);

    // If no entrance is selected, target is base house
    if (!state.entrance) {
      return { exists: true, path: housePath, items: null, needsListing: true };
    }

    // Entrance is selected: must not fall back to base house!
    if (!isCompleteEntrance()) {
      return { exists: false, incomplete: true, path: null, items: [], needsListing: false };
    }

    const extension = state.currentExtension;
    if (!extension || !extension.folder) return { exists: false, path: null, items: [], needsListing: false };
    if (state.entrance === "porch") {
      return { exists: true, path: mediaPath(housePath, "porch", extension.folder), items: null, needsListing: true };
    }
    return { exists: true, path: mediaPath(housePath, "terrace", state.terraceType, extension.folder), items: null, needsListing: true };
  }

  async function refreshMedia() {
    state.request += 1;
    const requestId = state.request;
    if (state.controller) state.controller.abort();
    state.controller = new AbortController();
    state.loading = true;
    setLoading(true);

    try {
      const signal = state.controller.signal;
      const seriesPath = mediaPath(state.seriesPath);
      const rootItems = await mediaProvider.list(seriesPath, signal);
      if (stale(requestId, signal)) return;

      state.houseChoices = buildHouseChoices(rootItems);
      if (!state.houseChoices.length) {
        showFatal("В каталоге нет доступных размеров этой серии.");
        return;
      }
      if (!state.houseChoices.some(c => c.key === state.houseKey)) {
        state.houseKey = state.houseChoices[0].key;
        clearEntrance();
      }
      state.currentHouse = currentHouse();

      let houseItems = [];
      let housePath = null;
      if (state.currentHouse && state.currentHouse.folder) {
        housePath = mediaPath(seriesPath, state.currentHouse.folder);
        houseItems = await mediaProvider.list(housePath, signal);
        if (stale(requestId, signal)) return;
      }

      state.availableEntrances = [];
      if (hasDirectory(houseItems, "porch")) state.availableEntrances.push("porch");
      if (hasDirectory(houseItems, "terrace")) state.availableEntrances.push("terrace");
      if (state.entrance && !state.availableEntrances.includes(state.entrance)) clearEntrance();

      state.availableTerraceTypes = [];
      state.extensionChoices = [];
      state.currentExtension = null;

      if (state.entrance === "porch" && housePath) {
        const porchPath = mediaPath(housePath, "porch");
        const porchItems = await mediaProvider.list(porchPath, signal);
        if (stale(requestId, signal)) return;
        state.extensionChoices = buildExtensionChoices(porchItems);
      }

      if (state.entrance === "terrace" && housePath) {
        const terracePath = mediaPath(housePath, "terrace");
        const terraceItems = await mediaProvider.list(terracePath, signal);
        if (stale(requestId, signal)) return;
        ["covered", "open"].forEach(t => {
          if (hasDirectory(terraceItems, t)) state.availableTerraceTypes.push(t);
        });
        if (state.terraceType && !state.availableTerraceTypes.includes(state.terraceType)) {
          state.terraceType = null;
          state.extensionKey = null;
        }
        if (state.terraceType) {
          const typePath = mediaPath(terracePath, state.terraceType);
          const typeItems = await mediaProvider.list(typePath, signal);
          if (stale(requestId, signal)) return;
          state.extensionChoices = buildExtensionChoices(typeItems);
        }
      }

      if (!state.extensionChoices.some(c => c.key === state.extensionKey)) {
        state.extensionKey = null;
      }
      // Auto-select if there is exactly 1 extension size available (e.g. Altai porch 2x3, Altai covered terrace 3x9)
      if (!state.extensionKey && state.extensionChoices.length === 1) {
        state.extensionKey = state.extensionChoices[0].key;
      }
      state.currentExtension = currentExtension();

      // If entrance is selected but user still needs to pick terrace execution or size:
      if (state.entrance && !isCompleteEntrance()) {
        const promptTitle = state.entrance === "porch"
          ? "Выберите размер крыльца"
          : (!state.terraceType ? "Выберите исполнение террасы" : "Выберите размер террасы");
        const promptText = state.entrance === "porch"
          ? "Укажите нужный размер крыльца в блоке параметров справа."
          : (!state.terraceType ? "Выберите крытую или открытую террасу в блоке справа." : "Укажите нужный размер террасы в блоке справа.");

        state.slides = [{
          type: "placeholder",
          name: "incomplete",
          order: 0,
          reason: "incomplete",
          title: promptTitle,
          text: promptText
        }];
        state.slideIndex = 0;
        state.loading = false;
        renderAll();
        renderGallery();
        return;
      }

      const target = resolveTarget(seriesPath);
      let targetItems = target.items;
      if (target.path && target.needsListing) {
        targetItems = await mediaProvider.list(target.path, signal);
        if (stale(requestId, signal)) return;
      }

      state.availableColors = target.exists ? COLOR_ORDER.filter(col => hasDirectory(targetItems, col)) : [];
      if (state.availableColors.length && !state.availableColors.includes(state.color)) {
        state.color = state.availableColors[0];
      } else if (!state.availableColors.length) {
        state.color = "bronze";
      }

      let slides = [];
      if (target.exists && state.availableColors.includes(state.color)) {
        const colorItems = await mediaProvider.list(mediaPath(target.path, state.color), signal);
        if (stale(requestId, signal)) return;
        slides = colorItems.filter(item => {
          return item && item.type === "file" && ALLOWED_IMAGE.test(item.name || "") && (item.preview || item.file);
        }).map(mediaItemToSlide).sort(compareSlides);
      }

      state.slides = slides.length ? slides : [makePlaceholderSlide("missing")];
      state.slideIndex = 0;
      state.loading = false;
      renderAll();
      renderGallery();
    } catch (error) {
      if (error && error.name === "AbortError") return;
      if (requestId !== state.request) return;
      console.warn("[Configurator Error]", error);
      state.currentHouse = currentHouse();
      state.availableEntrances = [];
      state.availableTerraceTypes = [];
      state.availableColors = [];
      state.extensionChoices = [];
      state.currentExtension = null;
      clearEntrance();
      state.loading = false;
      state.slides = [makePlaceholderSlide("error")];
      state.slideIndex = 0;
      renderAll();
      renderGallery();
    } finally {
      if (requestId === state.request) setLoading(false);
    }
  }

  function clearEntrance() {
    state.entrance = null;
    state.terraceType = null;
    state.extensionKey = null;
    state.extensionChoices = [];
    state.currentExtension = null;
  }

  function stale(requestId, signal) {
    if (signal.aborted) throw new Error("Aborted");
    return requestId !== state.request;
  }

  function setLoading(val) {
    if (elements.stage) {
      elements.stage.classList.toggle("is-loading", val);
      elements.stage.setAttribute("aria-busy", val ? "true" : "false");
    }
  }

  function showFatal(msg) {
    if (elements.fatal) {
      elements.fatal.hidden = false;
      elements.fatal.textContent = msg;
    }
  }

  function renderAll() {
    state.currentHouse = currentHouse();
    state.currentExtension = currentExtension();
    renderControls();
    renderDetails();
  }

  function renderControls() {
    if (!elements.sizeSelect) return;

    // 1. Sizes dropdown
    elements.sizeSelect.innerHTML = state.houseChoices.map(c => {
      const priceText = priceLabel(c.price);
      return `<option value="${escapeHtml(c.key)}" ${c.key === state.houseKey ? "selected" : ""}>${escapeHtml(c.label)} | ${priceText}</option>`;
    }).join("");

    // 2. Colors
    if (elements.colorSection) {
      elements.colorSection.hidden = !state.loading && !state.availableColors.length;
      elements.colorOptions.innerHTML = COLOR_ORDER.map(col => {
        const dot = `<span class="hc-color-dot" aria-hidden="true" style="background:${COLOR_VALUES[col]}"></span>`;
        const isSelected = state.color === col;
        const isDisabled = !state.availableColors.includes(col);
        return choiceButton("color", col, COLOR_LABELS[col], isSelected, dot, isDisabled);
      }).join("");
    }

    // 3. Entrance (ONLY "Крыльцо" and "Терраса", NO "Без пристроя")
    if (elements.entranceSection) {
      elements.entranceSection.hidden = !state.loading && !state.availableEntrances.length;
      elements.entranceOptions.innerHTML = ["porch", "terrace"].filter(e => state.availableEntrances.includes(e)).map(e => {
        return choiceButton("entrance", e, ENTRANCE_LABELS[e], state.entrance === e, "", false);
      }).join("");
    }

    // 4. Terrace Type (Крытая / Открытая)
    if (elements.terraceTypeSection) {
      elements.terraceTypeSection.hidden = state.entrance !== "terrace" || !state.availableTerraceTypes.length;
      elements.terraceTypeOptions.innerHTML = ["covered", "open"].filter(t => state.availableTerraceTypes.includes(t)).map(t => {
        return choiceButton("terrace-type", t, TERRACE_LABELS[t], state.terraceType === t, "", false);
      }).join("");
    }

    // 5. Extension Size (Размер крыльца или террасы)
    if (elements.extensionSizeSection) {
      const showSizes = state.entrance === "porch" || (state.entrance === "terrace" && !!state.terraceType);
      elements.extensionSizeSection.hidden = !showSizes || !state.extensionChoices.length;
      if (elements.extensionStepNumber) {
        elements.extensionStepNumber.textContent = state.entrance === "terrace" ? "5" : "4";
      }
      if (elements.extensionSizeTitle) {
        elements.extensionSizeTitle.textContent = state.entrance === "porch"
          ? "Размер крыльца"
          : (state.terraceType === "open" ? "Размер открытой террасы" : "Размер крытой террасы");
      }
      elements.extensionSizeOptions.innerHTML = state.extensionChoices.map(c => {
        const priceText = c.price ? ` | ${priceLabel(c.price)}` : "";
        return choiceButton("extension-size", c.key, c.label + priceText, state.extensionKey === c.key, "", false);
      }).join("");
    }
  }

  function renderDetails() {
    const house = state.currentHouse;
    const total = calculateTotalPrice();

    if (elements.projectTitle) elements.projectTitle.textContent = projectTitle();
    if (elements.summaryPrice) elements.summaryPrice.textContent = formatPrice(total);
    if (elements.summaryType) elements.summaryType.textContent = state.typeName || "Модульный дом";
    if (elements.summarySeries) elements.summarySeries.textContent = state.seriesName || "Алтай";
    if (elements.summarySize) elements.summarySize.textContent = house ? `${house.label} (${house.area} м²)` : "—";
    if (elements.summaryEntrance) elements.summaryEntrance.textContent = entranceSummary();
    if (elements.summaryColor) elements.summaryColor.textContent = COLOR_LABELS[state.color] || "—";
  }

  function choiceButton(kind, value, label, selected, prefix, disabled) {
    return `<button type="button" class="hc-choice${selected ? " is-selected" : ""}" data-${kind}="${escapeHtml(value)}" aria-pressed="${selected ? "true" : "false"}"${disabled ? ' disabled aria-disabled="true"' : ""}>${prefix || ""}<span>${escapeHtml(label)}</span></button>`;
  }

  function renderGallery() {
    const slide = state.slides[state.slideIndex];
    if (!slide) return;
    renderStageSlide(slide);
    renderThumbnails();

    const images = state.slides.filter(s => s.type === "image");
    const multiple = images.length > 1;
    if (elements.previous) elements.previous.hidden = !multiple || state.slideIndex === 0;
    if (elements.next) elements.next.hidden = !multiple || state.slideIndex === state.slides.length - 1;
    if (elements.galleryCounter) elements.galleryCounter.textContent = images.length ? `${state.slideIndex + 1} / ${images.length}` : "";
  }

  function renderStageSlide(slide) {
    if (!elements.stageContent) return;
    elements.stageContent.innerHTML = "";

    if (slide.type === "placeholder") {
      const ph = document.createElement("div");
      ph.className = "hc-placeholder";
      ph.innerHTML = `
        <div class="hc-placeholder-card">
          <span class="hc-placeholder-icon" aria-hidden="true">⌂</span>
          <h3 class="hc-placeholder-title">${escapeHtml(slide.title)}</h3>
          <p class="hc-placeholder-text">${escapeHtml(slide.text)}</p>
        </div>
      `;
      elements.stageContent.appendChild(ph);
      return;
    }

    const img = document.createElement("img");
    img.className = "hc-stage-image" + (slide.kind === "plan" ? " is-plan" : "");
    img.src = slide.url;
    img.referrerPolicy = slide.referrerPolicy || "no-referrer";
    img.alt = projectTitle() + " — " + (KIND_LABELS[slide.kind] || KIND_LABELS.image);
    img.decoding = "async";
    img.addEventListener("error", function () {
      const broken = makePlaceholderSlide("error");
      renderStageSlide(broken);
    }, { once: true });
    elements.stageContent.appendChild(img);
  }

  function renderThumbnails() {
    if (!elements.thumbnails) return;
    elements.thumbnails.innerHTML = "";
    const images = state.slides.filter(s => s.type === "image");
    elements.thumbnails.hidden = images.length <= 1;
    if (images.length <= 1) return;

    state.slides.forEach((slide, idx) => {
      if (slide.type !== "image") return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "hc-thumb" + (idx === state.slideIndex ? " is-active" : "");
      btn.dataset.slideIndex = String(idx);
      btn.setAttribute("aria-label", "Показать изображение " + (idx + 1));
      btn.setAttribute("aria-current", idx === state.slideIndex ? "true" : "false");

      const img = document.createElement("img");
      img.src = slide.thumbnailUrl || slide.url;
      img.referrerPolicy = slide.referrerPolicy || "no-referrer";
      img.alt = "";
      img.loading = "lazy";
      img.className = slide.kind === "plan" ? "is-plan" : "";
      btn.appendChild(img);
      elements.thumbnails.appendChild(btn);
    });
  }

  function showSlide(idx) {
    if (!state.slides.length) return;
    state.slideIndex = Math.max(0, Math.min(idx, state.slides.length - 1));
    renderGallery();
  }

  function bindEvents() {
    if (!root) return;

    // Series Tabs / Buttons (if present)
    document.querySelectorAll('[data-series-tab]').forEach(tab => {
      tab.addEventListener('click', (e) => {
        e.preventDefault();
        const slug = tab.dataset.seriesTab;
        const name = tab.dataset.seriesName || tab.textContent.trim();
        loadSeries(slug, name);
        document.querySelectorAll('[data-series-tab]').forEach(t => t.classList.remove('is-active'));
        tab.classList.add('is-active');
      });
    });

    root.addEventListener("click", function (event) {
      // 1. Entrance click (toggles on/off!)
      const entranceBtn = event.target.closest("[data-entrance]");
      if (entranceBtn && root.contains(entranceBtn)) {
        if (entranceBtn.disabled) return;
        const nextEntrance = entranceBtn.dataset.entrance;
        if (state.entrance === nextEntrance) {
          clearEntrance();
        } else {
          state.entrance = nextEntrance;
          state.terraceType = null;
          state.extensionKey = null;
        }
        state.slides = [];
        renderAll();
        refreshMedia();
        return;
      }

      // 2. Color click
      const colorBtn = event.target.closest("[data-color]");
      if (colorBtn && root.contains(colorBtn)) {
        if (colorBtn.disabled) return;
        state.color = colorBtn.dataset.color;
        state.slides = [];
        renderAll();
        refreshMedia();
        return;
      }

      // 3. Terrace Type click (toggles on/off)
      const typeBtn = event.target.closest("[data-terrace-type]");
      if (typeBtn && root.contains(typeBtn)) {
        if (typeBtn.disabled) return;
        const type = typeBtn.dataset.terraceType;
        state.terraceType = state.terraceType === type ? null : type;
        state.extensionKey = null;
        state.slides = [];
        renderAll();
        refreshMedia();
        return;
      }

      // 4. Extension Size click
      const sizeBtn = event.target.closest("[data-extension-size]");
      if (sizeBtn && root.contains(sizeBtn)) {
        if (sizeBtn.disabled) return;
        state.extensionKey = sizeBtn.dataset.extensionSize;
        state.availableColors = [];
        state.slides = [];
        renderAll();
        refreshMedia();
        return;
      }

      // 5. Thumbnails click
      const thumb = event.target.closest("[data-slide-index]");
      if (thumb && root.contains(thumb)) {
        showSlide(Number(thumb.dataset.slideIndex));
        return;
      }

      // 6. Arrows click
      const navAction = event.target.closest('[data-action="previous-slide"], [data-action="next-slide"]');
      if (navAction && root.contains(navAction)) {
        if (navAction.dataset.action === "previous-slide") showSlide(state.slideIndex - 1);
        if (navAction.dataset.action === "next-slide") showSlide(state.slideIndex + 1);
        return;
      }

      // 7. «Получить расчёт» CTA click (glowing orange button)
      const ctaBtn = event.target.closest('[data-cta]');
      if (ctaBtn && root.contains(ctaBtn)) {
        event.preventDefault();
        const leadForm = document.getElementById('housesLeadForm') || document.getElementById('saunasLeadForm') || document.getElementById('mainLeadForm');
        const leadSection = document.getElementById('lead-form');
        if (leadForm) {
          const subtitle = leadSection ? leadSection.querySelector('.lead-banner-subtitle') : null;
          if (subtitle) {
            subtitle.innerHTML = `Выбран проект: <strong>${escapeHtml(projectTitle())}</strong> (${formatPrice(calculateTotalPrice())}). Оставьте контакты для детальной сметы:`;
          }
          let commentInput = leadForm.querySelector('input[name="comment"]');
          if (!commentInput) {
            commentInput = document.createElement('input');
            commentInput.type = 'hidden';
            commentInput.name = 'comment';
            leadForm.appendChild(commentInput);
          }
          commentInput.value = `Расчёт: ${projectTitle()} | Цвет: ${COLOR_LABELS[state.color] || ''} | Цена: ${formatPrice(calculateTotalPrice())}`;

          if (leadSection) {
            leadSection.scrollIntoView({ behavior: 'smooth' });
          }
          const firstInput = leadForm.querySelector('input[type="text"]');
          if (firstInput) setTimeout(() => firstInput.focus(), 500);
        }
        return;
      }

      // 8. «Добавить в корзину» click
      const cartBtn = event.target.closest('[data-hc-add-to-cart]');
      if (cartBtn && root.contains(cartBtn)) {
        event.preventDefault();
        if (typeof Cart !== 'undefined') {
          const activeSlide = state.slides.find(s => s.type === "image");
          Cart.addItem({
            title: projectTitle(),
            price: calculateTotalPrice(),
            image: activeSlide ? activeSlide.url : '/houses/altai/9x9.5__p4259000/bronze/main.jpg',
            details: {
              'Серия': state.seriesName,
              'Размер': state.currentHouse ? state.currentHouse.label : '',
              'Цвет фасада': COLOR_LABELS[state.color] || 'Бронза',
              'Входная группа': entranceSummary()
            }
          });
          Cart.openDrawer();
        }
        return;
      }
    });

    if (elements.sizeSelect) {
      elements.sizeSelect.addEventListener("change", function () {
        state.houseKey = elements.sizeSelect.value;
        clearEntrance();
        state.availableColors = [];
        state.availableEntrances = [];
        state.availableTerraceTypes = [];
        state.slides = [];
        renderAll();
        refreshMedia();
      });
    }

    if (elements.stage) {
      elements.stage.addEventListener("keydown", function (event) {
        if (event.key === "ArrowLeft") { event.preventDefault(); showSlide(state.slideIndex - 1); }
        if (event.key === "ArrowRight") { event.preventDefault(); showSlide(state.slideIndex + 1); }
      });

      let pointerStart = null;
      elements.stage.addEventListener("pointerdown", function (event) {
        if (event.isPrimary) pointerStart = { x: event.clientX, y: event.clientY };
      });
      elements.stage.addEventListener("pointerup", function (event) {
        if (!pointerStart || !event.isPrimary) return;
        const deltaX = event.clientX - pointerStart.x;
        const deltaY = event.clientY - pointerStart.y;
        pointerStart = null;
        if (Math.abs(deltaX) < 46 || Math.abs(deltaX) < Math.abs(deltaY)) return;
        showSlide(state.slideIndex + (deltaX < 0 ? 1 : -1));
      });
      elements.stage.addEventListener("pointercancel", function () { pointerStart = null; });
    }
  }

  function escapeHtml(val) {
    return String(val == null ? "" : val)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function loadSeries(slug, name) {
    state.seriesSlug = slug;
    state.seriesName = name || slug.charAt(0).toUpperCase() + slug.slice(1);
    state.seriesPath = (state.categorySlug === 'saunas' ? 'saunas/' : 'houses/') + slug;
    state.houseKey = "";
    state.color = "bronze";
    clearEntrance();
    state.slides = [];
    refreshMedia();
  }

  async function init(rootSelector = '[data-hc-root]', defaultSeries = 'altai', options = {}) {
    root = document.querySelector(rootSelector);
    if (!root) return;

    // Read config node if present
    const configNode = document.querySelector('[data-hc-config]');
    let config = {};
    if (configNode) {
      try {
        config = JSON.parse(configNode.textContent || "{}");
      } catch (e) {
        console.warn("Could not parse data-hc-config", e);
      }
    }

    state.categorySlug = options.categorySlug || (window.location.pathname.includes('sauna') ? 'saunas' : 'houses');
    state.typeName = config.typeName || (state.categorySlug === 'saunas' ? 'Баня' : 'Дом');
    state.seriesName = config.seriesName || (state.categorySlug === 'saunas' ? 'Классика' : 'Алтай');
    state.seriesSlug = defaultSeries || (state.categorySlug === 'saunas' ? 'klassika' : 'altai');
    state.seriesPath = config.media && config.media.seriesPath ? config.media.seriesPath : (state.categorySlug + '/' + state.seriesSlug);

    if (config.media && config.media.provider === "yandexDisk") {
      mediaProvider = createYandexDiskProvider(config.media);
    } else {
      mediaProvider = createLocalProvider();
    }

    elements = {
      layout: query(".hc-layout"),
      fatal: query("[data-fatal]"),
      stage: query("[data-stage]"),
      stageContent: query("[data-stage-content]"),
      galleryLoading: query("[data-gallery-loading]"),
      galleryCounter: query("[data-gallery-counter]"),
      thumbnails: query("[data-thumbnails]"),
      previous: query('[data-action="previous-slide"]'),
      next: query('[data-action="next-slide"]'),
      sizeSelect: query("[data-size-select]"),
      colorSection: query("[data-color-section]"),
      colorOptions: query("[data-color-options]"),
      entranceSection: query("[data-entrance-section]"),
      entranceOptions: query("[data-entrance-options]"),
      terraceTypeSection: query("[data-terrace-type-section]"),
      terraceTypeOptions: query("[data-terrace-type-options]"),
      extensionSizeSection: query("[data-extension-size-section]"),
      extensionStepNumber: query("[data-extension-step-number]"),
      extensionSizeTitle: query("[data-extension-size-title]"),
      extensionSizeOptions: query("[data-extension-size-options]"),
      projectTitle: query("[data-project-title]"),
      summaryPrice: query("[data-summary-price]"),
      summaryType: query("[data-summary-type]"),
      summarySeries: query("[data-summary-series]"),
      summarySize: query("[data-summary-size]"),
      summaryEntrance: query("[data-summary-entrance]"),
      summaryColor: query("[data-summary-color]"),
      cta: query("[data-cta]")
    };

    bindEvents();
    root.setAttribute("data-hc-ready", "");
    await refreshMedia();
  }

  return {
    init,
    loadSeries,
    getState: () => ({ ...state })
  };
})();
