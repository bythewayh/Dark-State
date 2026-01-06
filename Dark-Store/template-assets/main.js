const Toast = Swal.mixin({
  toast: true,
  position: "top-start",
  iconColor: "white",
  customClass: {
    popup: "colored-toast",
  },
  showConfirmButton: false,
  timer: 3000,
  timerProgressBar: true,
});
let basketIdentPromise = null;
const NEAddPackageAfterDiscordLCKey = "add-after-discord";
const NEAddPackageAfterLoginLCKey = "add-after-login";
const NEPreviousPageLCKey = "previous-page";
const NEPreviousPageDiscordLCKey = "previous-page-discord";
const NEDiscordTagIdLCKey = "discord-tag-id";
const packageTypeCache = {};

$(async function () {
  await onDomLoaded();
});

async function onDomLoaded() {
  AOS.init();
  createHotPackagesFromFeatured();
  initPackagePage();
  initPackages();
  initCategorySearch();
  initLoginPopup();
  initBasket();

  await maybeRedirectAfterLogin();
  await maybeDiscordAuthenticated();
  await maybeAfterDiscordPurchasing();
  await maybeAfterLoginPurchasing();
}

async function maybeAfterDiscordPurchasing() {
  const discordTag = localStorage.getItem(NEDiscordTagIdLCKey);
  const content = localStorage.getItem(NEAddPackageAfterDiscordLCKey);

  localStorage.removeItem(NEAddPackageAfterDiscordLCKey);
  localStorage.removeItem(NEDiscordTagIdLCKey);
  if (!discordTag || !content) return;

  const [packageId, giftTo, packageType = "single"] = content.split("/");
  const res = await addToBasketWithOptions(
    packageId,
    discordTag,
    giftTo,
    packageType
  );

  if (res.success) {
    newToast("success", "Success", __("package added to your basket!"));
    openOrUpdateBasket();
  } else {
    console.error("couldnt add to basket error message : ", res.message);
    newToast(
      "error",
      "Error",
      __("couldnt add package to basket! please try again")
    );
  }
}

function maybeDiscordAuthenticated() {
  return new Promise((resolve) => {
    const discordTag = $('input[name="discordTag"]').attr("value");
    if (discordTag) {
      const previousPage = localStorage.getItem(NEPreviousPageDiscordLCKey);
      if (previousPage && previousPage !== window.location.href) {
        localStorage.removeItem(NEPreviousPageDiscordLCKey);
        localStorage.setItem(NEDiscordTagIdLCKey, discordTag);
        window.location.href = previousPage;
      } else {
        resolve();
      }
    } else {
      resolve();
    }
  });
}

function maybeRedirectAfterLogin() {
  return new Promise((resolve) => {
    if (!NETemplate.isLoggedIn) {
      resolve();
      return;
    }

    const previousPage = localStorage.getItem(NEPreviousPageLCKey);
    const hasPackageToAdd = localStorage.getItem(NEAddPackageAfterLoginLCKey);

    if (
      previousPage &&
      previousPage !== window.location.href &&
      hasPackageToAdd
    ) {
      localStorage.removeItem(NEPreviousPageLCKey);
      window.location.href = previousPage;
    } else {
      localStorage.removeItem(NEPreviousPageLCKey);
      resolve();
    }
  });
}

async function maybeAfterLoginPurchasing() {
  if (!NETemplate.isLoggedIn) return;

  const content = localStorage.getItem(NEAddPackageAfterLoginLCKey);
  if (!content) return;

  localStorage.removeItem(NEAddPackageAfterLoginLCKey);

  const [packageId, giftTo, packageType = "single"] = content.split("/");

  const result = await addToBasket(packageId, giftTo, packageType);

  if (result.success) {
    if (result.message === "discord-popup") {
      return;
    }
    updateButtonState(packageId, false);
    newToast("success", "Success", __("package added to your basket!"));
    openOrUpdateBasket();
  } else {
    console.error("couldnt add to basket after login:", result.message);
    if (result.message) {
      newToast("error", "Error", result.message);
    } else {
      newToast(
        "error",
        "Error",
        __("couldnt add package to basket! please try again")
      );
    }
  }
}

function initBasket() {
  const showBasketBtn = $(".show-basket");
  const basketCloseBtn = $(".basket-close");

  if (showBasketBtn.length && !showBasketBtn.data("listener-set")) {
    showBasketBtn.on("click", () => {
      openOrUpdateBasket();
    });
    showBasketBtn.data("listener-set", true);
  }

  if (basketCloseBtn.length && !basketCloseBtn.data("listener-set")) {
    basketCloseBtn.on("click", () => {
      $(".basket").fadeOut();
    });
    basketCloseBtn.data("listener-set", true);
  }
}

function isBasketOpen() {
  return $(".basket").is(":visible");
}

async function openOrUpdateBasket(showLoader = true) {
  const basketWrapper = $(".basket");
  if (!basketWrapper.length) return;

  const basketInnerWrapper = basketWrapper.find(".basket-inner-wrapper");
  if (showLoader) {
    if (isBasketOpen())
      basketInnerWrapper.append(
        '<div class="loading-data absolute-center"></div>'
      );
    else
      basketInnerWrapper.html(
        '<div class="loading-data absolute-center"></div>'
      );
  }

  if (!isBasketOpen()) basketWrapper.fadeIn();

  let cancelled = false;
  function closeAction(e) {
    if ($(e.target).is(basketWrapper)) {
      cancelled = true;
      basketWrapper.fadeOut();
    }
  }
  basketWrapper.off("click", closeAction).on("click", closeAction);

  basketIdentPromise = getBasketIdent();

  if (cancelled) {
    return null;
  }

  let result;
  try {
    result = await fetch("/checkout/basket");
  } catch (e) {
    console.error("couldnt fetch basket : ", { e });
    Toast.fire({
      icon: "error",
      title: "Error",
      text: __("couldnt fetch basket detail! please refresh and try again."),
    });
    return null;
  }

  if (cancelled) {
    return null;
  }

  if (result.redirected) {
    basketInnerWrapper.html(
      `<div class="absolute-center text-white font-medium text-[24px] w-full text-center">Basket is empty!</div>`
    );
    return;
  }

  const html = await result.text();
  if (cancelled) {
    return null;
  }

  const basketSidebar = getBySelectorFromHTML(html, "[basket-sidebar]");

  const basket = $(basketSidebar);

  const packages = basket.find(".basket-package-list [data-package-detail]");
  if (packages.length) {
    packages.each(function () {
      const package = $(this);

      const detail = package.attr("data-package-detail");
      if (!detail) {
        console.error("couldnt get detail of the basket package :", {
          package,
        });
        return;
      }

      const packageId = package.attr("data-package-id");
      if (!packageId) {
        console.error("couldnt get package id from basket :", { package });
        return;
      }

      const deleteBtn = package.find(".basket-package-delete");
      let loading = false;
      deleteBtn.on("click", async (e) => {
        e.preventDefault();
        if (loading) return;

        const content = deleteBtn.html();
        deleteBtn.css("width", deleteBtn.css("width"));
        deleteBtn.addClass("bg-delete");
        deleteBtn.html('<div class="btn-loading"></div>');

        loading = true;

        const result = await removeFromBasket(packageId);
        if (result) {
          openOrUpdateBasket(false);
          updateButtonState(packageId, true);
        } else {
          Toast.fire({
            icon: "error",
            title: "Error",
            text: __("couldnt remove package, please refresh and try again."),
          });
          deleteBtn.removeClass("bg-delete");
          deleteBtn.css("width", "");
          deleteBtn.html(content);
        }
        loading = false;
      });

      const { name, tags, tops } = extractPackageDetail(detail);

      if (!name) {
        console.error("couldnt find name of the basket package : ", {
          package,
        });
        return;
      }
      package.find(".basket-package-name").html(name);

      if (!tags.length) return;
      const tagsWrapper = package.find(".basket-package-tags");
      tags.forEach((item) => {
        $(
          `<span
                  class="text-[12px] sm:text-[12px] tracking-[-0.5%] lowercase font-medium text-[#FFFFFF]/59 bg-[#212127] px-[5px] sm:px-[7px] py-[5px] sm:py-[4px] rounded-[3px] sm:rounded-[4px] flex-center"
                  >${item}</span>`
        ).appendTo(tagsWrapper);
      });
    });
  }

  basket.find(".checkout-btn").on("click", () => {
    openCheckout();
  });

  basketInnerWrapper.html(basket);
  cancelled = false;
}

async function removeFromBasket(packageId) {
  try {
    const response = await fetch(`/checkout/packages/remove/${packageId}`);
    return response.ok;
  } catch (e) {
    console.error("couldnt fetch remove basket", { e });
    return false;
  }
}

function sanitizePurchaseType(type) {
  if (type === "subscribe" || type === "subscription") {
    return "subscribe";
  }
  return "single";
}

async function detectPackageType(packageId, packageElm = null) {
  if (packageElm) {
    const typeAttr = packageElm.attr("data-package-type");
    if (typeAttr) {
      const sanitized = sanitizePurchaseType(typeAttr);
      packageTypeCache[packageId] = sanitized;
      return sanitized;
    }
  }

  if (packageTypeCache[packageId]) {
    return packageTypeCache[packageId];
  }

  try {
    const singleUrl = `/checkout/packages/add/${packageId}/single`;
    const response = await fetch(singleUrl);
    const html = await response.text();

    if (html.includes("subscribe") || html.includes("subscription")) {
      const elm = document.createElement("template");
      elm.innerHTML = html;
      const hasSubscriptionIndicator =
        elm.content.querySelector('input[value="subscription"]') ||
        elm.content.querySelector('input[value="subscribe"]') ||
        elm.content.querySelector('form[action*="/subscribe"]') ||
        elm.content.querySelector('[data-type="subscription"]') ||
        elm.content.querySelector('[data-type="subscribe"]') ||
        elm.content.querySelector(".subscribe");

      if (hasSubscriptionIndicator) {
        packageTypeCache[packageId] = "subscribe";
        return "subscribe";
      }
    }

    packageTypeCache[packageId] = "single";
    return "single";
  } catch (e) {
    console.warn("Could not detect package type, defaulting to single", e);
    return "single";
  }
}

async function addToBasket(packageId, giftTo = "", typeAction = null) {
  if (!typeAction) {
    typeAction = await detectPackageType(packageId);
  }

  typeAction = sanitizePurchaseType(typeAction);

  let url = `/checkout/packages/add/${packageId}/${typeAction}`;

  if (giftTo) {
    url += `/gift?username=${giftTo}`;
  }

  let response, html;
  try {
    response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    html = await response.text();
  } catch (e) {
    console.error("couldnt get html from page", { url, e });
    return {
      success: false,
      message: __("couldnt fetch result"),
    };
  }

  const elm = document.createElement("template");
  elm.innerHTML = html;

  const qhtml = $(elm.content);

  const discordLoginRequired = qhtml
    .find('input[name="discordLoginRequired"]')
    .attr("value");
  const discordTag = qhtml.find('input[name="discordTag"]').attr("value");

  if (discordLoginRequired) {
    localStorage.setItem(
      NEAddPackageAfterDiscordLCKey,
      `${packageId}/${giftTo}/${typeAction}`
    );
    localStorage.setItem(NEPreviousPageDiscordLCKey, window.location.href);
    openDiscordPopup(qhtml);
    return {
      success: true,
      message: "discord-popup",
    };
  }

  const discordLogin = qhtml.find('input[name="discordLogin"]').attr("value");

  if (discordLogin) {
    return await addToBasketWithOptions(
      packageId,
      discordTag,
      giftTo,
      typeAction
    );
  } else {
    return handleBasketToastMessage(qhtml);
  }
}

function updateButtonState(packageId, state = true) {
  const packagePage = $(`.package-page[data-package-id="${packageId}"]`);
  if (packagePage.length) {
    packagePage.find(".package-remove").toggle(!state);
    packagePage.find(".gift-wrapper").toggle(state);
    packagePage.find(".package-add-to-cart").toggle(state);
  }

  const categoryPackage = $(`.package-list [data-package-id="${packageId}"]`);
  if (categoryPackage) {
    categoryPackage.find(".package-remove").toggle(!state);
    categoryPackage.find(".package-add-to-cart").toggle(state);
  }

  const featuredPackage = $(
    `.featured-package[data-package-id="${packageId}"]`
  );
  if (featuredPackage) {
    featuredPackage.find(".package-remove").toggle(!state);
    featuredPackage.find(".package-add-to-cart").toggle(state);
  }
}

async function getBasketIdent() {
  try {
    const data = await fetch("/checkout/ident");
    if (!data.ok) {
      console.error("couldnt fetch ident page", data);
      return null;
    }

    const result = await data.json();
    const ident = result?.ident;
    if (!ident) {
      console.error("couldnt get ident from result", { data, result });
      return null;
    }
    return ident;
  } catch (e) {
    console.error("Error fetching basket ident:", e);
    return null;
  }
}

function initLoginPopup() {
  const loginBtn = $(".show-login-fivem");
  if (loginBtn.length && !loginBtn.data("listener-set")) {
    loginBtn.on("click", showLogin);
    loginBtn.data("listener-set", true);
  }
}

function showLogin() {
  if (!loginCached) {
    fetchLoginPopup();
    return;
  }
  $(".login-fivem").fadeIn();
}

function hideLogin() {
  $(".login-fivem").fadeOut();
}

let loginCached = false;
async function fetchLoginPopup() {
  if (loginCached) return;
  const wrapperLogin = $(".login-fivem");
  if (!wrapperLogin.length) return;

  wrapperLogin.fadeIn();
  let cancelled = false;

  wrapperLogin.on("click", (e) => {
    if ($(e.target).is(wrapperLogin)) {
      if (!loginCached) cancelled = true;
      hideLogin();
    }
  });

  try {
    const result = await fetch("/login");

    if (cancelled) return null;

    if (!result.ok) {
      console.error("Error fetching login page:", result.status);
      wrapperLogin.fadeOut();
      return;
    }

    const html = await result.text();

    if (cancelled) return null;

    if (!html) {
      console.error("Empty response from login page");
      wrapperLogin.fadeOut();
      return;
    }

    const loginPopup = getBySelectorFromHTML(html, "[login-popup]");
    const popup = $(loginPopup);
    const cancelBtn = $(
      `<button
              class="fivem-cancel cursor-pointer w-[50%] flex-center gap-[6px] sm:gap-[8px] tracking-[-0.4px] h-[40px] sm:h-[42px] md:h-[45px] bg-white/4 rounded-[10px] text-[#FFFFFF]/40 text-[14px] sm:text-[15px] md:text-[16px] font-medium hover:bg-red-500/20 transition-all duration-300 hover:text-red-500"
            >
              Cancel
            </button>`
    );
    cancelBtn.on("click", hideLogin);

    popup.find(".login-with-button").before(cancelBtn);
    wrapperLogin.html(popup);
    loginCached = true;
  } catch (e) {
    console.error("Error in fetchLoginPopup:", e);
    wrapperLogin.fadeOut();
  }
}

function initCategorySearch() {
  const search = $(".search");
  if (!search.length) return;

  search.on("input", (e) => {
    const input = $(e.target);
    const value = input.val().toLowerCase();

    const items = $(".package-list > *");
    items.hide();

    for (const item of items) {
      const elm = $(item);
      const content = elm.text().toLowerCase();
      if (content.includes(value)) elm.show();
    }
  });
}

function initPackagePage() {
  const page = $(".package-page");
  if (!page.length) return;

  const packageId = page.attr("data-package-id");
  if (!packageId) {
    console.error("couldnt find package id attribute : ", { page });
    return;
  }

  const detail = page.attr("data-package-detail");
  if (!detail) {
    console.error("couldnt find detail in package page", page);
    return;
  }

  sliderPackage();

  const addCartBtn = page.find(".package-add-to-cart");
  const removeCartBtn = page.find(".package-remove");
  addToBasketButtonListener(packageId, addCartBtn, removeCartBtn, {
    successHandler() {
      page.find(".gift-wrapper").hide();
    },
  });
  removeFromBasketButtonListener(packageId, removeCartBtn, addCartBtn, {
    successHandler() {
      page.find(".gift-wrapper").show();
    },
  });

  $(".recent-payments").remove();

  const { name, tags, tops } = extractPackageDetail(detail);

  if (!name) {
    console.error("couldnt find name in package detail", {
      page,
      detail,
    });
    return;
  }

  // Set name
  page.find(".package-page-name").html(name.trim());

  const tagsWrapper = page.find(".package-page-tags");
  if (tagsWrapper.length) {
    tagsWrapper.html("");
    const tagsArr = Array.isArray(tags) ? tags : [];
    tagsArr.forEach((item) => {
      const text = (item || "").trim();
      if (!text) return;
      $(
        `
				
				<span
                  class="text-[14px] md:text-[16px] tracking-[-0.5%] lowercase font-medium text-[#FFFFFF]/59 bg-white/4 px-[8px] md:px-[10px] py-[3px] md:py-[4px] rounded-[6px] flex-center"
                  >${text}</span
                >
                `
      ).appendTo(tagsWrapper);
    });
  }

  // --- TOPS: independent rendering, do NOT overwrite .package-first-tag ---
  const topsWrapper = page.find(".package-page-tops");
  if (topsWrapper.length) {
    topsWrapper.html("");
    const topsArr = Array.isArray(tops) ? tops : [];
    topsArr.forEach((item) => {
      const text = (item || "").trim();
      if (!text) return;
      $(
        `
        <span
                  class="text-[11px] md:text-[13px] tracking-[-0.5%] font-semibold text-[var(--dark-color-secondary)] bg-[var(--color-primary)] px-[8px] md:px-[10px] py-[3px] md:py-[4px] rounded-[6px] flex-center"
                >
                  ${text}
                </span>`
      ).appendTo(topsWrapper);
    });
  }
}

function initPackages() {
  const packages = $(".package-list [data-package-detail]");
  if (!packages.length) return;

  packages.each(handlePackage);
}

function handlePackage() {
  const packageElm = $(this);
  const packageData = packageElm.attr("data-package-detail");
  if (!packageData) {
    console.error("couldnt find package data", { packageElm });
    return;
  }

  const packageId = packageElm.attr("data-package-id");
  if (!packageId) {
    console.error("couldnt find package id", { packageElm });
    return;
  }

  const addCartBtn = packageElm.find(".package-add-to-cart");
  const removeCartBtn = packageElm.find(".package-remove");

  addToBasketButtonListener(packageId, addCartBtn, removeCartBtn);
  removeFromBasketButtonListener(packageId, removeCartBtn, addCartBtn);

  const { name, tags, tops } = extractPackageDetail(packageData);

  if (!name) {
    console.error("couldnt find name in package detail", {
      packageElm,
      packageData,
    });
    return;
  }

  packageElm.find(".package-name").html(name.trim());

  const tagsWrapper = packageElm.find(".package-tags");
  if (tagsWrapper.length) {
    tagsWrapper.html("");
    const tagsArr = Array.isArray(tags) ? tags : [];
    tagsArr.forEach((item) => {
      const text = (item || "").trim();
      if (!text) return;
      $(
        `<span
          class="text-[12px] md:text-[14px] tracking-[-0.5%] lowercase font-medium text-[#FFFFFF]/59 bg-white/4 px-[7px] py-[2px] rounded-[6px] flex-center"
        >${text}</span>`
      ).appendTo(tagsWrapper);
    });
  }

  const topsWrapper = packageElm.find(".package-tops");
  if (topsWrapper.length) {
    topsWrapper.html("");
    const topsArr = Array.isArray(tops) ? tops : [];
    topsArr.forEach((item) => {
      const text = (item || "").trim();
      if (!text) return;
      $(
        `<span
          class="text-[13px] tracking-[-0.5%] font-semibold text-[var(--dark-color-secondary)] bg-[var(--color-primary)] px-[10px] py-[4px] rounded-[6px] flex-center"
        >${text}</span>`
      ).appendTo(topsWrapper);
    });
  }
}

const ListSectionHTML = `<section
    class="container mx-auto mt-[50px] md:mt-[70px] lg:mt-[100px] flex flex-col items-start justify-start gap-[25px] md:gap-[40px] px-4" data-aos="fade-up" data-aos-duration="1000"
  >
    <div class="flex flex-col items-start justify-start gap-[6px]">
      <h2 class="text-[24px] md:text-[30px] font-normal">Hot Packages</h2>
      <h3 class="text-[18px] md:text-[22px] text-[var(--color-primary)] font-normal">
        Check out our hot packages
      </h3>
    </div>
    <div
      class="hot-packages flex flex-wrap flex-col md:flex-row items-stretch md:items-start justify-start gap-[20px] md:gap-[35px] w-full overflow-x-visible"
    >
    </div>
  </section>`;

function createHotPackagesFromFeatured(opts = {}) {
  const { insertBeforeSelector = ".services-cards", pickCount = 3 } = opts;

  const featured = Array.from(document.querySelectorAll(".featured-package"));
  if (!featured.length) return null;

  const tmp = document.createElement("div");
  tmp.innerHTML = ListSectionHTML.trim();
  const section = tmp.firstElementChild;

  let insertBeforeNode = null;
  if (insertBeforeSelector)
    insertBeforeNode = document.querySelector(insertBeforeSelector);
  if (!insertBeforeNode && featured[0]) insertBeforeNode = featured[0];

  if (insertBeforeNode && insertBeforeNode.parentNode) {
    insertBeforeNode.parentNode.insertBefore(section, insertBeforeNode);
  } else {
    document.body.appendChild(section);
  }

  const hotContainer = section.querySelector(".hot-packages");
  if (!hotContainer) {
    console.error("Failed to create hot-packages container.");
    return null;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  const shuffled = shuffle(featured.slice());
  const toPick = Math.min(pickCount, shuffled.length);
  const selected = shuffled.slice(0, toPick);

  selected.forEach((node) => {
    hotContainer.appendChild(node);
    if (window.jQuery) {
      $(node).each(handlePackage);
    } else {
      try {
        handlePackage.call(node);
      } catch (e) {
        console.warn("Error handling package:", e);
      }
    }
  });

  const selectedSet = new Set(selected);
  shuffled.forEach((node) => {
    if (!selectedSet.has(node)) {
      if (node.parentNode) node.parentNode.removeChild(node);
    }
  });

  return section;
}

function sliderPackage() {
  // Global YouTube player variable
  let player;
  let mainSwiper;
  let isVideoPlaying = false;

  // YouTube IFrame API ready callback
  function onYouTubeIframeAPIReady() {
    player = new YT.Player("youtube-player", {
      events: {
        onStateChange: onPlayerStateChange,
      },
    });
  }

  // YouTube player state change handler
  function onPlayerStateChange(event) {
    if (event.data === YT.PlayerState.PLAYING) {
      // Video is playing - stop autoplay
      isVideoPlaying = true;
      if (mainSwiper && mainSwiper.autoplay) {
        mainSwiper.autoplay.stop();
      }
    } else if (
      event.data === YT.PlayerState.PAUSED ||
      event.data === YT.PlayerState.ENDED
    ) {
      // Video is paused or ended - resume autoplay
      isVideoPlaying = false;
      if (mainSwiper && mainSwiper.autoplay) {
        mainSwiper.autoplay.start();
      }
    }
  }

  // Initialize thumbnail swiper first
  const thumbsSwiper = new Swiper(".packageThumbsSwiper", {
    spaceBetween: 10,
    slidesPerView: 4,
    freeMode: true,
    watchSlidesProgress: true,
    breakpoints: {
      320: {
        slidesPerView: 4,
        spaceBetween: 8,
      },
      768: {
        slidesPerView: 4,
        spaceBetween: 10,
      },
      1024: {
        slidesPerView: 4,
        spaceBetween: 15,
      },
    },
  });

  // Initialize main swiper
  mainSwiper = new Swiper(".packageMainSwiper", {
    spaceBetween: 10,
    navigation: {
      nextEl: ".swiper-button-next",
      prevEl: ".swiper-button-prev",
    },
    thumbs: {
      swiper: thumbsSwiper,
    },
    autoplay: {
      delay: 5000,
      disableOnInteraction: false,
      pauseOnMouseEnter: true,
    },
    loop: false,
    on: {
      slideChange: function () {
        // If not on the first slide (video slide), make sure video is paused
        if (this.activeIndex !== 0 && player && player.pauseVideo) {
          player.pauseVideo();
        }
      },
      slideChangeTransitionStart: function () {
        // When leaving the video slide, pause the video
        if (this.previousIndex === 0 && player && player.pauseVideo) {
          player.pauseVideo();
        }
      },
    },
  });

  // Add custom styling for active thumbnail
  const style = document.createElement("style");
  style.textContent = `
          .packageThumbsSwiper .swiper-slide {
            opacity: 0.6;
            transition: opacity 0.3s ease;
          }
          .packageThumbsSwiper .swiper-slide-thumb-active {
            opacity: 1;
            border: 2px solid #FFB53D;
            border-radius: 8px;
          }
          @media (min-width: 768px) {
            .packageThumbsSwiper .swiper-slide-thumb-active {
              border-radius: 15px;
            }
          }
          .swiper-button-next,
          .swiper-button-prev {
            background: rgba(22, 22, 26, 0.8);
            width: 40px;
            height: 40px;
            border-radius: 50%;
          }
          .swiper-button-next:after,
          .swiper-button-prev:after {
            font-size: 16px;
          }
          @media (max-width: 768px) {
            .swiper-button-next,
            .swiper-button-prev {
              width: 30px;
              height: 30px;
            }
            .swiper-button-next:after,
            .swiper-button-prev:after {
              font-size: 12px;
            }
          }
        `;
  document.head.appendChild(style);
}

function extractPackageDetail(detail) {
  const match = detail.match(/^(?:\[(.+?)\])?\s*([^{}]*)?\s*(?:\{(.+?)\})?$/);
  if (!match) return { name: null, tags: [], tops: [] };

  let [, name, rawTags, rawTops] = match;

  // Clean up all values
  name = name?.trim();
  rawTags = rawTags?.trim();
  rawTops = rawTops?.trim();

  // If no brackets → treat the whole string as name, no tags/tops
  if (!name) {
    return {
      name: detail.trim(),
      tags: [],
      tops: [],
    };
  }

  // Normal parse for bracketed names
  const tags = rawTags ? rawTags.split(/\s+/).filter(Boolean) : [];
  const tops = rawTops ? rawTops.split(/\s+/).filter(Boolean) : [];

  return { name, tags, tops };
}

function addToBasketButtonListener(
  packageId,
  addButtonElm,
  removeButtonElm,
  { successHandler, failHandler } = {}
) {
  let loading = false;
  addButtonElm.on("click", async (e) => {
    e.preventDefault();
    if (!NETemplate.isLoggedIn) {
      const packageElm = addButtonElm.closest("[data-package-id]");
      const packageType = await detectPackageType(packageId, packageElm);
      const giftTo = packageElm.find('input[name="giftTo"]').val() || "";

      localStorage.setItem(
        NEAddPackageAfterLoginLCKey,
        `${packageId}/${giftTo}/${packageType}`
      );
      localStorage.setItem(NEPreviousPageLCKey, window.location.href);
      showLogin();
      return;
    }
    if (loading) return;

    const content = addButtonElm.html();
    const width = addButtonElm.css("width");
    addButtonElm.css("width", width);
    addButtonElm.addClass("bg-primary");
    addButtonElm.html('<div class="btn-loading"></div>');
    loading = true;

    const packageElm = addButtonElm.closest("[data-package-id]");
    const packageType = await detectPackageType(packageId, packageElm);
    const giftTo = packageElm.find('input[name="giftTo"]').val() || "";

    const result = await addToBasket(packageId, giftTo, packageType);
    if (result.success) {
      if (result.message === "discord-popup") {
        addButtonElm.removeClass("bg-primary");
        addButtonElm.css("width", "");
        addButtonElm.html(content);
        loading = false;
        return;
      }
      addButtonElm.hide();
      openOrUpdateBasket();
      updateButtonState(packageId, false);
      successHandler?.();
      removeButtonElm.show();
    } else {
      console.error("couldnt add!", { res: result.message });
      Toast.fire({
        icon: "error",
        title: "Error",
        text: __(
          "couldnt add package to basket! please refresh and try again."
        ),
      });
      failHandler?.(result);
    }
    addButtonElm.removeClass("bg-primary");
    addButtonElm.css("width", "");
    addButtonElm.html(content);
    loading = false;
  });
}

function removeFromBasketButtonListener(
  packageId,
  removeButtonElm,
  addButtonElm,
  { successHandler, failHandler } = {}
) {
  let loading = false;
  removeButtonElm.on("click", async (e) => {
    e.preventDefault();
    if (!NETemplate.isLoggedIn) {
      return showLogin();
    }
    if (loading) return;

    const content = removeButtonElm.html();
    const width = removeButtonElm.css("width");
    removeButtonElm.css("width", width);
    removeButtonElm.addClass("bg-delete");
    removeButtonElm.html('<div class="btn-loading"></div>');
    loading = true;

    const result = await removeFromBasket(packageId);
    if (result) {
      removeButtonElm.hide();
      updateButtonState(packageId, true);
      successHandler?.();
      addButtonElm.show();
    } else {
      console.error("couldnt remove!");
      Toast.fire({
        icon: "error",
        title: "Error",
        text: __(
          "couldnt remove package from basket! please refresh and try again."
        ),
      });
      failHandler?.(result);
    }
    removeButtonElm.removeClass("bg-delete");
    removeButtonElm.css("width", "");
    removeButtonElm.html(content);
    loading = false;
  });
}

/**
 * Gets an element by selector from HTML
 * @param {string} html
 * @param {string} selector
 * @returns {?DocumentFragment} - Returns null if not found
 */
function getBySelectorFromHTML(html, selector) {
  const tempEl = document.createElement("template");

  tempEl.innerHTML = html;

  const result = tempEl.content.querySelector(selector);

  if (!result) {
    return null;
  }

  const documentFragment = document.createDocumentFragment();

  documentFragment.append(...result.children);

  return documentFragment;
}

function handleBasketToastMessage(html) {
  const toastMessageElm = html.find("[data-toast]");
  if (!toastMessageElm.length) {
    console.error("couldnt find toast message in response HTML");
    return {
      success: false,
      message: __("toast message couldnt be found"),
    };
  }

  const toastMessage = toastMessageElm.attr("data-toast");
  if (toastMessage) {
    return {
      success: false,
      message: toastMessage,
    };
  }
  return {
    success: true,
  };
}

async function openCheckout() {
  if (!basketIdentPromise) {
    console.warn("openCheckout(): basket ident promise not set");
    return;
  }

  const basketIdent = await basketIdentPromise;

  if (!basketIdent) {
    console.warn("openCheckout(): could not get basket ident");
    return;
  }

  const bodyStyles = window.getComputedStyle(document.body),
    primaryColor = bodyStyles.getPropertyValue("--color-primary");
  const config = {
    ident: basketIdent,
    theme: "auto",
    locale: NETemplate.locale,
    colors: [
      {
        name: "primary",
        color: primaryColor,
      },
    ],
  };

  Tebex.checkout.init(config);
  Tebex.checkout.launch();
  Tebex.checkout.on(Tebex.events.PAYMENT_COMPLETE, (event) => {
    console.log("Payment completed!", event);
    basketIdentPromise = null;
  });
}

function openDiscordPopup(html) {
  const discordWrapper = $(".login-discord");
  discordWrapper.fadeIn();

  discordWrapper.on("click", (e) => {
    if ($(e.target).is(discordWrapper)) {
      discordWrapper.fadeOut();
    }
  });

  discordWrapper.html('<div class="loading-data"></div>');

  if (!html) {
    console.error("couldnt get html of the login page");
    return;
  }

  const popup = html.find("[discord-popup]");
  const cancelBtn = $(
    ` <button
            class="fivem-cancel cursor-pointer w-[50%] flex-center gap-[6px] sm:gap-[8px] tracking-[-0.4px] h-[40px] sm:h-[42px] md:h-[45px] bg-white/4 rounded-[10px] text-[#FFFFFF]/40 text-[14px] sm:text-[15px] md:text-[16px] font-medium hover:bg-red-500/20 transition-all duration-300 hover:text-red-500"
          >
            Cancel
          </button> `
  );
  cancelBtn.on("click", () => {
    discordWrapper.fadeOut();
  });

  popup.find(".login-with-button").before(cancelBtn);
  discordWrapper.html(popup);
}

async function addToBasketWithOptions(
  packageId,
  discordTag,
  giftTo,
  typeAction = "single"
) {
  typeAction = sanitizePurchaseType(typeAction);
  let url = `/checkout/packages/add/${packageId}/${typeAction}`;

  if (giftTo) {
    url += `/gift?username=${giftTo}`;
  }

  const body = new URLSearchParams();
  body.append("variables[discord_id]", discordTag);
  body.append("username", giftTo || "");
  body.append("submit", "1");

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    if (!response.ok) {
      console.error("HTTP error in addToBasketWithOptions:", response.status);
      return {
        success: false,
        message: __("couldnt send request!"),
      };
    }

    updateButtonState(packageId, false);

    const elm = document.createElement("template");
    elm.innerHTML = await response.text();

    const html = $(elm.content);
    return handleBasketToastMessage(html);
  } catch (e) {
    console.error("Error in addToBasketWithOptions:", e);
    return {
      success: false,
      message: __("network error occurred"),
    };
  }
}

/**
 *
 * @param {success|error|info|warning|question} type
 * @param {string} title
 * @param {string} text
 */
function newToast(type, title, text) {
  Toast.fire({
    icon: type,
    title,
    text,
  });
}
