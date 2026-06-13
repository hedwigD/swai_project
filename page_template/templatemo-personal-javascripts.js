document.documentElement.classList.add("js");

const mobileMenuToggle = document.getElementById("mobileMenuToggle");
const mobileMenu = document.getElementById("mobileMenu");
const mobileNavLinks = document.querySelectorAll(".mobile-nav-links a");
const navbar = document.getElementById("navbar");
const pageTimerValue = document.getElementById("pageTimerValue");
const confessionChoices = document.querySelectorAll("[data-confession-choice]");
const demoUrl = document.body.dataset.demoUrl || "../practice.html";

const launchNotifyForm = document.getElementById("launchNotifyForm");
const launchFormStatus = document.getElementById("launchFormStatus");
const launchEmailInput = document.getElementById("launchEmail");
const launchAdviceInput = document.getElementById("launchAdvice");
const launchHoneyInput = document.getElementById("launchHoney");

const trackingConfig = {
    appScriptUrl: "",
    visitorsTable: "visitors",
    launchTable: "tab_final",
    confessionTable: "intro_choices",
    ipLookupUrl: "https://jsonip.com?format=jsonp",
    debug: true,
    ...(window.launchTrackingConfig || {})
};

const debugLog = (...args) => {
    if (trackingConfig.debug) {
        console.log("[launch-tracking]", ...args);
    }
};

const closeMobileMenu = () => {
    if (!mobileMenuToggle || !mobileMenu) {
        return;
    }

    mobileMenuToggle.classList.remove("active");
    mobileMenu.classList.remove("active");
    mobileMenuToggle.setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
};

if (mobileMenuToggle && mobileMenu) {
    mobileMenuToggle.addEventListener("click", () => {
        const isActive = mobileMenu.classList.toggle("active");
        mobileMenuToggle.classList.toggle("active", isActive);
        mobileMenuToggle.setAttribute("aria-expanded", String(isActive));
        document.body.style.overflow = isActive ? "hidden" : "";
    });

    mobileNavLinks.forEach((link) => {
        link.addEventListener("click", closeMobileMenu);
    });

    document.addEventListener("click", (event) => {
        if (!mobileMenu.contains(event.target) && !mobileMenuToggle.contains(event.target)) {
            closeMobileMenu();
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeMobileMenu();
        }
    });
}

const updateNavbar = () => {
    if (!navbar) {
        return;
    }

    navbar.classList.toggle("scrolled", window.scrollY > 24);
};

updateNavbar();
window.addEventListener("scroll", updateNavbar, { passive: true });

document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", (event) => {
        const href = anchor.getAttribute("href");
        const target = href ? document.querySelector(href) : null;

        if (!target) {
            return;
        }

        event.preventDefault();
        const offsetTop = target.getBoundingClientRect().top + window.scrollY - 72;

        window.scrollTo({
            top: offsetTop,
            behavior: "smooth"
        });

        closeMobileMenu();
    });
});

const revealElements = document.querySelectorAll(".fade-in, .slide-in-left, .slide-in-right");
const portfolioItems = document.querySelectorAll(".portfolio-item");

if ("IntersectionObserver" in window) {
    const revealObserver = new IntersectionObserver(
        (entries, observer) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) {
                    return;
                }

                entry.target.classList.add("animate");
                observer.unobserve(entry.target);
            });
        },
        {
            threshold: 0.16,
            rootMargin: "0px 0px -8% 0px"
        }
    );

    revealElements.forEach((element) => revealObserver.observe(element));

    const grid = document.querySelector(".portfolio-grid");
    if (grid && portfolioItems.length > 0) {
        const staggerObserver = new IntersectionObserver(
            (entries, observer) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) {
                        return;
                    }

                    portfolioItems.forEach((item, index) => {
                        window.setTimeout(() => {
                            item.classList.add("animate");
                        }, index * 120);
                    });

                    observer.unobserve(entry.target);
                });
            },
            {
                threshold: 0.18
            }
        );

        staggerObserver.observe(grid);
    }
} else {
    revealElements.forEach((element) => element.classList.add("animate"));
    portfolioItems.forEach((item) => item.classList.add("animate"));
}

const padValue = (value) => String(value).padStart(2, "0");

const formatElapsedTime = (elapsedMs) => {
    const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${padValue(hours)}:${padValue(minutes)}:${padValue(seconds)}`;
    }

    return `${padValue(minutes)}:${padValue(seconds)}`;
};

const startPageTimer = () => {
    if (!pageTimerValue) {
        return;
    }

    const startTime = Date.now();

    const render = () => {
        pageTimerValue.textContent = formatElapsedTime(Date.now() - startTime);
    };

    render();
    window.setInterval(render, 1000);
};

const getTimeStamp = () => {
    const date = new Date();

    return [
        `${date.getFullYear()}-${padValue(date.getMonth() + 1)}-${padValue(date.getDate())}`,
        `${padValue(date.getHours())}:${padValue(date.getMinutes())}:${padValue(date.getSeconds())}`
    ].join(" ");
};

const getCookieValue = (name) => {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);

    if (parts.length === 2) {
        return decodeURIComponent(parts.pop().split(";").shift());
    }

    return "";
};

const setCookieValue = (name, value, days) => {
    let expires = "";

    if (days) {
        const date = new Date();
        date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
        expires = `; expires=${date.toUTCString()}`;
    }

    document.cookie = `${name}=${encodeURIComponent(value || "")}${expires}; path=/; SameSite=Lax`;
};

const getVisitorId = () => {
    const existingHash = getCookieValue("user");

    if (existingHash) {
        return existingHash;
    }

    const hash = Math.random().toString(36).substring(2, 8).toUpperCase();
    setCookieValue("user", hash, 180);
    return hash;
};

const getDeviceType = () => {
    const userAgent = navigator.userAgent || "";

    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent)
        ? "mobile"
        : "desktop";
};

const getUtmValue = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const singleUtm = urlParams.get("utm");

    if (singleUtm) {
        return singleUtm;
    }

    const detailedUtm = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]
        .map((key) => {
            const value = urlParams.get(key);
            return value ? `${key}:${value}` : "";
        })
        .filter(Boolean)
        .join(" | ");

    return detailedUtm;
};

const buildUrlWithParams = (url, params) => {
    const searchParams = new URLSearchParams();

    Object.entries(params).forEach(([key, value]) => {
        searchParams.set(key, value);
    });

    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}${searchParams.toString()}`;
};

const jsonpRequest = (url, params = {}) =>
    new Promise((resolve, reject) => {
        const callbackName = `__launchJsonp${Date.now()}${Math.floor(Math.random() * 1000)}`;
        const script = document.createElement("script");
        const target = document.head || document.body;
        let timeoutId = 0;

        const cleanup = () => {
            window.clearTimeout(timeoutId);

            if (script.parentNode) {
                script.parentNode.removeChild(script);
            }

            try {
                delete window[callbackName];
            } catch (error) {
                window[callbackName] = undefined;
            }
        };

        window[callbackName] = (response) => {
            cleanup();
            resolve(response);
        };

        timeoutId = window.setTimeout(() => {
            cleanup();
            reject(new Error("JSONP request timed out."));
        }, 12000);

        script.onerror = () => {
            cleanup();
            reject(new Error("JSONP request failed."));
        };

        script.src = buildUrlWithParams(url, {
            ...params,
            callback: callbackName
        });

        target.appendChild(script);
    });

const getClientIp = async () => {
    if (!trackingConfig.ipLookupUrl) {
        return "unknown";
    }

    try {
        const response = await jsonpRequest(trackingConfig.ipLookupUrl);
        return response && response.ip ? response.ip : "unknown";
    } catch (error) {
        debugLog("IP lookup failed.", error);
        return "unknown";
    }
};

const insertRecord = async (tableName, payload) => {
    if (!trackingConfig.appScriptUrl) {
        throw new Error("Apps Script URL is not configured.");
    }

    return jsonpRequest(trackingConfig.appScriptUrl, {
        action: "insert",
        table: tableName,
        data: JSON.stringify(payload)
    });
};

const setFormStatus = (message, type = "") => {
    if (!launchFormStatus) {
        return;
    }

    launchFormStatus.textContent = message;
    launchFormStatus.className = "notify-status";

    if (message) {
        launchFormStatus.classList.add("is-visible");
    }

    if (type) {
        launchFormStatus.classList.add(`is-${type}`);
    }
};

const validateEmail = (email) => {
    const pattern = /^([\w-]+(?:\.[\w-]+)*)@((?:[\w-]+\.)*\w[\w-]{0,66})\.([a-z]{2,6}(?:\.[a-z]{2})?)$/i;
    return pattern.test(email);
};

const logVisitorVisit = async () => {
    if (!trackingConfig.appScriptUrl) {
        debugLog("Visitor logging skipped because appScriptUrl is empty.");
        return;
    }

    const payload = {
        id: getVisitorId(),
        landingUrl: window.location.href,
        ip: await getClientIp(),
        referer: document.referrer || "",
        time_stamp: getTimeStamp(),
        utm: getUtmValue(),
        device: getDeviceType()
    };

    try {
        const response = await insertRecord(trackingConfig.visitorsTable, payload);
        debugLog("Visitor log inserted.", response);
    } catch (error) {
        console.error("[launch-tracking] Failed to insert visitor log.", error);
    }
};

const logConfessionChoice = async (choiceElement) => {
    if (!trackingConfig.appScriptUrl) {
        debugLog("Intro choice logging skipped because appScriptUrl is empty.");
        return;
    }

    const choiceValue = choiceElement.dataset.confessionChoice || "";
    const payload = {
        id: getVisitorId(),
        choice: choiceValue,
        choice_type: choiceValue,
        landingUrl: window.location.href,
        ip: await getClientIp(),
        referer: document.referrer || "",
        time_stamp: getTimeStamp(),
        utm: getUtmValue(),
        device: getDeviceType()
    };

    try {
        const response = await insertRecord(trackingConfig.confessionTable, payload);
        debugLog("Intro choice log inserted.", response);
    } catch (error) {
        console.error("[launch-tracking] Failed to insert intro choice log.", error);
    }
};

confessionChoices.forEach((choice) => {
    choice.setAttribute("href", demoUrl);

    choice.addEventListener("click", (event) => {
        logConfessionChoice(choice);

        const choiceValue = choice.dataset.confessionChoice || "";

        if (choiceValue === "no" && !window.confirm("증명해보세요")) {
            event.preventDefault();
            return;
        }

        if (choiceValue === "yes") {
            window.alert("확인해보세요");
        }
    });
});

const handleLaunchSubmit = async (event) => {
    event.preventDefault();

    if (!launchNotifyForm || !launchEmailInput || !launchAdviceInput) {
        return;
    }

    if (launchHoneyInput && launchHoneyInput.value.trim() !== "") {
        return;
    }

    const email = launchEmailInput.value.trim();
    const advice = launchAdviceInput.value.trim();
    const submitButton = launchNotifyForm.querySelector('button[type="submit"]');

    if (!validateEmail(email)) {
        setFormStatus("이메일 주소를 다시 한 번 확인해주세요.", "error");
        launchEmailInput.focus();
        return;
    }

    if (!trackingConfig.appScriptUrl) {
        setFormStatus("지금은 알림 신청을 받을 수 없어요. 잠시 후 다시 시도해주세요.", "error");
        return;
    }

    const payload = {
        id: getVisitorId(),
        email,
        advice
    };

    launchNotifyForm.classList.add("is-submitting");
    setFormStatus("알림 신청 정보를 전송하고 있습니다.", "loading");

    if (submitButton) {
        submitButton.disabled = true;
    }

    try {
        const response = await insertRecord(trackingConfig.launchTable, payload);
        debugLog("Launch signup inserted.", response);
        launchNotifyForm.reset();
        setFormStatus("신청이 완료되었습니다. 출시 소식이 준비되면 가장 먼저 알려드릴게요.", "success");
    } catch (error) {
        console.error("[launch-tracking] Failed to insert launch signup.", error);
        setFormStatus("지금은 신청이 원활하지 않아요. 잠시 후 다시 시도해주세요.", "error");
    } finally {
        launchNotifyForm.classList.remove("is-submitting");

        if (submitButton) {
            submitButton.disabled = false;
        }
    }
};

if (launchNotifyForm) {
    launchNotifyForm.addEventListener("submit", handleLaunchSubmit);
}

window.addEventListener("load", () => {
    startPageTimer();
    logVisitorVisit();
});
