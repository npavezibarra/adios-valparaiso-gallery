(function () {
	"use strict";

	function getForcedLogin() {
		try {
			return new URLSearchParams(window.location.search).get("avp_logged_in") === "1";
		} catch (e) {
			return false;
		}
	}

	function withForcedParam(url) {
		if (!getForcedLogin()) return url;
		return url + (url.indexOf("?") === -1 ? "?" : "&") + "avp_logged_in=1";
	}

	function $(root, sel) {
		return root.querySelector(sel);
	}

	function ajax(action, payload) {
		var cfg = (window.AVP_GALLERY || {});
		if (!cfg.directRatingUrl) {
			var scripts = document.querySelectorAll('script[src*="/assets/js/gallery.js"]');
			for (var i = 0; i < scripts.length; i++) {
				var src = scripts[i].getAttribute("src") || "";
				if (!src) continue;
				// Busca el script del plugin bajo /wp-content/plugins/<plugin>/assets/js/gallery.js
				if (src.indexOf("/wp-content/plugins/") === -1) continue;
				cfg.directRatingUrl = src.replace(/\/assets\/js\/gallery\.js(?:\?.*)?$/, "/avp-rating-endpoint.php");
				cfg.directApiUrl = src.replace(/\/assets\/js\/gallery\.js(?:\?.*)?$/, "/avp-api.php");
				break;
			}
		}
		if (!cfg.directApiUrl && cfg.directRatingUrl) {
			cfg.directApiUrl = cfg.directRatingUrl.replace(/\/avp-rating-endpoint\.php(?:\?.*)?$/, "/avp-api.php");
		}
		if (!cfg.ajaxUrl) {
			// Fallback: si no se inyectó por PHP, asume admin-ajax estándar.
			cfg.ajaxUrl = window.location.origin.replace(/\/$/, "") + "/wp-admin/admin-ajax.php";
		}
		// Normaliza restUrl a absoluta del mismo origin (evita issues de cookies por http/https).
		if (cfg.restUrl && cfg.restUrl.charAt(0) === "/") {
			cfg.restUrl = window.location.origin.replace(/\/$/, "") + cfg.restUrl;
		}
		if (!cfg.restUrl) {
			var apiLink = document.querySelector('link[rel="https://api.w.org/"]');
			if (apiLink && apiLink.getAttribute("href")) {
				cfg.restUrl = apiLink.getAttribute("href").replace(/\/$/, "") + "/avp/v1";
			} else {
				// Fallback best-effort (works for most installs with pretty permalinks).
				cfg.restUrl = window.location.origin.replace(/\/$/, "") + "/wp-json/avp/v1";
			}
		}
		// Prefer REST API (wp-json) to avoid wp-admin restrictions / HTML responses.
		function legacyAjax() {
			var body = new URLSearchParams();
			body.set("action", action);
			body.set("nonce", cfg.nonce || "");
			Object.keys(payload || {}).forEach(function (k) {
				body.set(k, payload[k]);
			});

			return fetch(cfg.ajaxUrl || "", {
				method: "POST",
				credentials: "same-origin",
				headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
				body: body.toString(),
			}).then(function (r) {
				var ct = (r.headers && r.headers.get && r.headers.get("content-type")) || "";
				if (ct.indexOf("application/json") === -1) {
					return r.text().then(function (t) {
						var flat = (t || "").replace(/\s+/g, " ");
						var m = flat.match(/<title[^>]*>([^<]+)<\/title>/i);
						var title = m ? m[1].trim() : "";
						var snippet = flat.slice(0, 260);
						var extra = title ? (" title=\"" + title + "\"") : "";
						throw new Error("admin-ajax no-JSON (HTTP " + r.status + ")" + extra + ": " + snippet);
					});
				}
				return r.json().then(function (j) {
					if (!r.ok || (j && j.success === false)) {
						var msg = (j && j.data && j.data.message) ? j.data.message : ("HTTP " + r.status);
						throw new Error(msg);
					}
					return j;
				});
			});
		}

		// Prefer plugin-local endpoint in production to avoid wp-json/wp-admin being blocked by WAF/cache.
		if (cfg.directApiUrl) {
			var apiUrl = cfg.directApiUrl;
			var body = new URLSearchParams();
			body.set("op", action === "avp_set_rating" ? "set_rating" :
				action === "avp_get_rating" ? "get_rating" :
				action === "avp_list_images" ? "list_images" :
				action === "avp_me" ? "me" :
				action === "avp_my_ratings" ? "my_ratings" :
				action === "avp_ranking" ? "ranking" : "");
			body.set("nonce", cfg.nonce || "");
			if (getForcedLogin()) body.set("avp_logged_in", "1");
			Object.keys(payload || {}).forEach(function (k) {
				if (action === "avp_my_ratings" && k === "imageKeys" && Array.isArray(payload[k])) {
					body.set("imageKeys", JSON.stringify(payload[k]));
					return;
				}
				body.set(k, payload[k]);
			});

			var method = (action === "avp_set_rating" || action === "avp_my_ratings") ? "POST" : "GET";
			var finalUrl = apiUrl;
			var fetchOpts = {
				method: method,
				credentials: "same-origin",
			};
			if (method === "GET") {
				finalUrl = apiUrl + (apiUrl.indexOf("?") === -1 ? "?" : "&") + body.toString();
			} else {
				fetchOpts.headers = { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" };
				fetchOpts.body = body.toString();
			}

			return fetch(finalUrl, fetchOpts).then(function (r) {
				var ct = (r.headers && r.headers.get && r.headers.get("content-type")) || "";
				if (ct.indexOf("application/json") === -1) {
					return r.text().then(function (t) {
						throw new Error("api no-JSON (HTTP " + r.status + "): " + (t || "").replace(/\s+/g, " ").slice(0, 180));
					});
				}
				return r.json().then(function (j) {
					if (!r.ok || (j && j.success === false)) {
						var msg = (j && j.data && j.data.message) ? j.data.message : ("HTTP " + r.status);
						throw new Error(msg);
					}
					return j;
				});
			});
		}

		if (action === "avp_set_rating" && cfg.directRatingUrl) {
			var directBody = new URLSearchParams();
			directBody.set("nonce", cfg.nonce || "");
			if (getForcedLogin()) {
				directBody.set("avp_logged_in", "1");
			}
			Object.keys(payload || {}).forEach(function (k) {
				directBody.set(k, payload[k]);
			});

			return fetch(cfg.directRatingUrl, {
				method: "POST",
				credentials: "same-origin",
				headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
				body: directBody.toString(),
			}).then(function (r) {
				var ct = (r.headers && r.headers.get && r.headers.get("content-type")) || "";
				if (ct.indexOf("application/json") === -1) {
					return r.text().then(function (t) {
						throw new Error("endpoint no-JSON (HTTP " + r.status + "): " + (t || "").replace(/\s+/g, " ").slice(0, 180));
					});
				}
				return r.json().then(function (j) {
					if (!r.ok || (j && j.success === false)) {
						var msg = (j && j.data && j.data.message) ? j.data.message : ("HTTP " + r.status);
						throw new Error(msg);
					}
					return j;
				});
			});
		}

		if (cfg.restUrl) {
			if (action === "avp_list_images") {
				var url = cfg.restUrl.replace(/\/$/, "") + "/list-images?folder=" + encodeURIComponent(payload.folder || "");
				url = withForcedParam(url);
				return fetch(url, {
					credentials: "same-origin",
					headers: { "X-WP-Nonce": cfg.restNonce || "" },
				}).then(function (r) { return r.json(); });
			}
			if (action === "avp_ranking") {
				var limit = payload.limit || 50;
				var minVotes = payload.minVotes || 1;
				var urlRank = cfg.restUrl.replace(/\/$/, "") + "/ranking?folder=" + encodeURIComponent(payload.folder || "") +
					"&limit=" + encodeURIComponent(String(limit)) +
					"&minVotes=" + encodeURIComponent(String(minVotes));
				urlRank = withForcedParam(urlRank);
				return fetch(urlRank, {
					credentials: "same-origin",
					headers: { "X-WP-Nonce": cfg.restNonce || "" },
				}).then(function (r) { return r.json(); });
			}
			if (action === "avp_my_ratings") {
				var urlMine = cfg.restUrl.replace(/\/$/, "") + "/my-ratings";
				urlMine = withForcedParam(urlMine);
				return fetch(urlMine, {
					method: "POST",
					credentials: getForcedLogin() ? "omit" : "same-origin",
					headers: {
						"Content-Type": "application/json",
						"X-WP-Nonce": cfg.restNonce || "",
						"X-AVP-Nonce": cfg.nonce || "",
					},
					body: JSON.stringify({
						imageKeys: payload.imageKeys || [],
					}),
				}).then(function (r) { return r.json(); });
			}
			if (action === "avp_get_rating") {
				var url2 = cfg.restUrl.replace(/\/$/, "") + "/rating?imageKey=" + encodeURIComponent(payload.imageKey || "");
				url2 = withForcedParam(url2);
				return fetch(url2, {
					credentials: "same-origin",
					headers: { "X-WP-Nonce": cfg.restNonce || "" },
				}).then(function (r) { return r.json(); });
			}
			if (action === "avp_set_rating") {
				var url3 = cfg.restUrl.replace(/\/$/, "") + "/rating";
				url3 = withForcedParam(url3);
				return fetch(url3, {
					method: "POST",
					// En modo avp_logged_in=1 evitamos enviar cookies para que WP REST no falle por nonce/cookie.
					credentials: getForcedLogin() ? "omit" : "same-origin",
					headers: {
						"Content-Type": "application/json",
						"X-WP-Nonce": cfg.restNonce || "",
						"X-AVP-Nonce": cfg.nonce || "",
					},
					body: JSON.stringify({
						imageKey: payload.imageKey,
						imageUrl: payload.imageUrl,
						rating: parseInt(payload.rating || "0", 10),
					}),
				}).then(function (r) {
					if (r.status === 401) throw new Error("Unauthorized");
					if (r.status === 403) throw new Error("HTTP 403");
					var ct = (r.headers && r.headers.get && r.headers.get("content-type")) || "";
					if (ct.indexOf("application/json") === -1) {
						return r.text().then(function () {
							throw new Error("HTTP " + r.status + " (no-JSON)");
						});
					}
					return r.json().then(function (j) {
						if (!r.ok || (j && j.success === false)) {
							var msg = (j && j.data && j.data.message) ? j.data.message : ("HTTP " + r.status);
							throw new Error(msg);
						}
						return j;
					});
				}).catch(function (e) {
					// Si el REST está bloqueado (403/WAF), cae a admin-ajax.
					var msg = (e && e.message) ? e.message : "";
					if (msg.indexOf("403") !== -1 || msg.indexOf("no-JSON") !== -1) {
						return legacyAjax();
					}
					throw e;
				});
			}
		}
		return legacyAjax();
	}

	function setShellView(shell, view) {
		if (!shell) return;
		shell.dataset.view = view;
		var tabs = shell.querySelectorAll(".avp-gallery-shell__tab");
		tabs.forEach(function (t) {
			t.classList.toggle("is-active", (t.dataset.view || "") === view);
		});
		var panels = shell.querySelectorAll(".avp-gallery-shell__panel");
		panels.forEach(function (p) {
			p.classList.toggle("is-active", (p.dataset.panel || "") === view);
		});

		if (view === "ranking") {
			var ranking = shell.querySelector(".avp-ranking");
			if (ranking && typeof ranking.__avpLoad === "function") {
				ranking.__avpLoad();
			}
		}
	}

	function initShell(shell) {
		var tabs = shell.querySelectorAll(".avp-gallery-shell__tab");
		tabs.forEach(function (tab) {
			tab.addEventListener("click", function () {
				setShellView(shell, tab.dataset.view || "gallery");
				try {
					window.location.hash = (tab.dataset.view || "gallery") === "ranking" ? "#ranking" : "#gallery";
				} catch (e) { }
			});
		});

		var initial = "gallery";
		try {
			var hash = (window.location.hash || "").toLowerCase();
			if (hash === "#ranking") initial = "ranking";
		} catch (e) { }

		setShellView(shell, initial);
	}

	function formatAvg(stats) {
		if (!stats) return "—";
		var votes = stats.votes || 0;
		var avg = typeof stats.avg === "number" ? stats.avg : 0;
		if (!votes) return "Sin votos aún";
		return "Promedio: " + avg.toFixed(2) + " (" + votes + " voto" + (votes === 1 ? "" : "s") + ")";
	}

	function createStars(container, onSelect) {
		container.innerHTML = "";
		for (var i = 0; i <= 5; i++) {
			(function (value) {
				var b = document.createElement("button");
				b.type = "button";
				b.className = "avp-gallery__star";
				b.setAttribute("role", "radio");
				b.setAttribute("aria-label", value === 0 ? "0 estrellas (limpiar)" : value + " estrellas");
				b.dataset.value = String(value);
				b.textContent = value === 0 ? "0" : "★";
				b.addEventListener("click", function () {
					onSelect(value);
				});
				container.appendChild(b);
			})(i);
		}
	}

	function setStars(container, rating, disabled) {
		var buttons = container.querySelectorAll(".avp-gallery__star");
		buttons.forEach(function (b) {
			var v = parseInt(b.dataset.value || "0", 10);
			b.classList.toggle("is-on", rating !== null && v !== 0 && v <= rating);
			b.classList.toggle("is-clear", v === 0);
			b.classList.toggle("is-active-clear", v === 0 && rating === 0);
			b.classList.toggle("is-disabled", !!disabled);
			b.setAttribute("aria-checked", rating !== null && v === rating ? "true" : "false");
			b.disabled = !!disabled;
		});
	}

	function initGallery(root) {
		// Pantalla de bloqueo (si el shortcode decidió que no hay sesión).
		if (root.classList.contains("avp-gallery--locked") || root.getAttribute("data-locked") === "1") {
			var btn = root.querySelector(".avp-gallery__login-btn");
			if (btn) {
				btn.addEventListener("click", function () {
					// Debe abrir el modal del plugin de cursos (vcp-auth-modal).
					// Hacemos detección + triggers múltiples para ser resilientes.
					function tryOpenModalByDom() {
						var modal =
							document.querySelector(".vcp-auth-modal") ||
							document.querySelector("#vcp-auth-modal") ||
							document.querySelector("[data-vcp-auth-modal]") ||
							document.querySelector(".vcp-auth") ||
							null;
						if (!modal) return false;

						try {
							modal.classList.add("is-open");
							modal.classList.add("open");
							modal.classList.remove("is-hidden");
							modal.removeAttribute("hidden");
							modal.setAttribute("aria-hidden", "false");
							// Muchos modales usan display:none.
							if (modal.style) {
								modal.style.display = "block";
								modal.style.visibility = "visible";
								modal.style.opacity = "1";
							}
							document.body.classList.add("vcp-auth-modal-open");
							document.documentElement.classList.add("vcp-auth-modal-open");

							var focusTarget =
								modal.querySelector("input[type=email]") ||
								modal.querySelector("input[type=text]") ||
								modal.querySelector("input") ||
								null;
							if (focusTarget && focusTarget.focus) focusTarget.focus();
						} catch (e) { }
						return true;
					}

					function tryClickTriggers() {
						var triggers = [
							"[data-vcp-auth-open]",
							"[data-open='vcp-auth-modal']",
							"[data-modal='vcp-auth-modal']",
							"a[href*='vcp-auth-modal']",
							".vcp-auth-open",
							".open-vcp-auth",
							".vcp-open-auth",
						];
						for (var i = 0; i < triggers.length; i++) {
							var el = document.querySelector(triggers[i]);
							if (el && el.click) {
								try { el.click(); } catch (e) { }
								return true;
							}
						}
						return false;
					}

					function tryGlobalApis() {
						try {
							if (window.VCPAuthModal && typeof window.VCPAuthModal.open === "function") {
								window.VCPAuthModal.open();
								return true;
							}
							if (window.VillegasCoursesLogin && typeof window.VillegasCoursesLogin.open === "function") {
								window.VillegasCoursesLogin.open();
								return true;
							}
							if (window.villegasCourses && typeof window.villegasCourses.openLogin === "function") {
								window.villegasCourses.openLogin();
								return true;
							}
							if (window.VCPCourses && typeof window.VCPCourses.openLogin === "function") {
								window.VCPCourses.openLogin();
								return true;
							}
						} catch (e) { }
						return false;
					}

					function tryEvents() {
						try {
							window.dispatchEvent(new CustomEvent("vcp-auth-modal:open"));
							window.dispatchEvent(new CustomEvent("vcp:auth:open"));
							window.dispatchEvent(new CustomEvent("villegas-courses:open-login"));
							window.dispatchEvent(new CustomEvent("vcp:open-login"));
						} catch (e) { }
						return true;
					}

					if (tryGlobalApis()) return;
					if (tryOpenModalByDom()) return;
					if (tryClickTriggers()) return;
					tryEvents();

					// Sin fallback a wp-login.php: mostramos un mensaje claro.
					setTimeout(function () {
						if (!tryOpenModalByDom()) {
							alert("No se pudo abrir el formulario de ingreso (vcp-auth-modal). Revisa que el plugin de cursos esté activo en esta página.");
						}
					}, 250);
				});
			}
			return;
		}

		var imagesJson = root.getAttribute("data-images") || "[]";
		var images;
		try {
			images = JSON.parse(imagesJson);
		} catch (e) {
			images = [];
		}
		var folder = root.getAttribute("data-folder") || "AdiosValparaiso";
		var source = root.getAttribute("data-source") || "uploads";

		var imgEl = $(root, ".avp-gallery__img");
		var nextBtn = $(root, ".avp-gallery__nav--next");
		var prevBtn = $(root, ".avp-gallery__nav--prev");
		var counterEl = $(root, ".avp-gallery__counter");
		var filenameEl = $(root, ".avp-gallery__filename");
		var avgEl = $(root, ".avp-gallery__avg");
		var starsEl = $(root, ".avp-gallery__stars");
		var filterSelect = $(root, ".avp-gallery__filter-select");

		var isLoggedIn = !!(window.AVP_GALLERY && window.AVP_GALLERY.isLoggedIn);
		if (getForcedLogin()) isLoggedIn = true;
		// No confies en isLoggedIn inicial (puede venir cacheado). No mostramos el hint por defecto.
		root.classList.remove("is-logged-out");

		var idx = 0;
		var current = null;
		var allImages = images.slice();
		var visibleImages = images.slice();
		var filterMode = "all";
		var myRatings = {};

		function ensureAuthState() {
			var cfg = (window.AVP_GALLERY || {});
			if (getForcedLogin()) {
				isLoggedIn = true;
				root.classList.toggle("is-logged-out", false);
				setStars(starsEl, null, false);
				return Promise.resolve(true);
			}
			// Usa el endpoint local del plugin si está disponible (evita wp-json nonce/cookies).
			return ajax("avp_me", {})
				.then(function (res) {
					if (res && res.success && res.data && typeof res.data.isLoggedIn === "boolean") {
						isLoggedIn = res.data.isLoggedIn;
						// Solo mostramos hint si el server confirma que NO hay sesion.
						root.classList.toggle("is-logged-out", !isLoggedIn);
						// Nunca deshabilites las estrellas solo por UI; el server decide.
						setStars(starsEl, null, false);
					}
					return isLoggedIn;
				})
				.catch(function () { return isLoggedIn; });
		}

		function ensureImagesLoaded() {
			if (images.length) {
				allImages = images.slice();
				visibleImages = images.slice();
				return Promise.resolve(images);
			}
			if (source !== "r2") return Promise.resolve(images);

			avgEl.textContent = "Cargando imágenes…";
			return ajax("avp_list_images", { folder: folder })
				.then(function (res) {
					if (!res || !res.success) {
						var msg = (res && res.data && res.data.message) ? res.data.message : "failed";
						throw new Error(msg);
					}
					images = res.data.images || [];
					allImages = images.slice();
					visibleImages = images.slice();
					return images;
				})
				.catch(function (e) {
					avgEl.textContent = e && e.message ? e.message : "No se pudieron cargar imágenes";
					images = [];
					allImages = [];
					visibleImages = [];
					return images;
				});
		}

		function ensureMyRatingsLoaded() {
			if (!isLoggedIn) {
				myRatings = {};
				return Promise.resolve(myRatings);
			}
			if (!allImages.length) {
				myRatings = {};
				return Promise.resolve(myRatings);
			}

			var keys = allImages.map(function (im) { return im.key; }).filter(Boolean);
			if (!keys.length) {
				myRatings = {};
				return Promise.resolve(myRatings);
			}

			return ajax("avp_my_ratings", { imageKeys: keys, imageKeysJson: JSON.stringify(keys) })
				.then(function (res) {
					if (!res || !res.success) throw new Error("failed");
					myRatings = (res.data && res.data.ratings) ? res.data.ratings : {};
					return myRatings;
				})
				.catch(function () {
					myRatings = {};
					return myRatings;
				});
		}

		function applyFilter() {
			if (!allImages.length) {
				visibleImages = [];
				return;
			}
			if (filterMode === "voted") {
				visibleImages = allImages.filter(function (im) {
					return Object.prototype.hasOwnProperty.call(myRatings || {}, im.key);
				});
				return;
			}
			if (filterMode === "unvoted") {
				visibleImages = allImages.filter(function (im) {
					return !Object.prototype.hasOwnProperty.call(myRatings || {}, im.key);
				});
				return;
			}
			visibleImages = allImages.slice();
		}

		function showByVisibleIndex(i) {
			if (!visibleImages.length) return;
			if (i < 0) i = visibleImages.length - 1;
			if (i >= visibleImages.length) i = 0;
			idx = i;
			current = visibleImages[idx];
			imgEl.src = current.url;
			counterEl.textContent = (idx + 1) + " / " + visibleImages.length;
			filenameEl.textContent = current.name || "";
			loadRatingsForCurrent();
		}

		function loadRatingsForCurrent() {
			if (!current) return;
			avgEl.textContent = "Cargando votos…";

			ajax("avp_get_rating", { imageKey: current.key })
				.then(function (res) {
					if (!res || !res.success) throw new Error("failed");
					avgEl.textContent = formatAvg(res.data.stats);
					if (res.data && typeof res.data.isLoggedIn === "boolean") {
						isLoggedIn = res.data.isLoggedIn;
						root.classList.toggle("is-logged-out", !isLoggedIn);
					}
					setStars(starsEl, res.data.userRating, false);
				})
				.catch(function () {
					avgEl.textContent = "No se pudo cargar la votación";
					setStars(starsEl, null, false);
				});
		}

		function show(i) {
			ensureImagesLoaded()
				.then(ensureMyRatingsLoaded)
				.then(function () {
					applyFilter();
					if (!visibleImages.length) {
						avgEl.textContent = "No hay imágenes para este filtro";
						counterEl.textContent = "";
						filenameEl.textContent = "";
						imgEl.removeAttribute("src");
						return;
					}
					showByVisibleIndex(i);
				});
		}

		function onSelectRating(value) {
			if (!current) return;
			avgEl.textContent = "Guardando…";
			ajax("avp_set_rating", { imageKey: current.key, imageUrl: current.url, rating: String(value) })
				.then(function (res) {
					if (!res || !res.success) throw new Error("failed");
					avgEl.textContent = formatAvg(res.data.stats);
					setStars(starsEl, res.data.userRating, false);
					if (isLoggedIn) {
						if (res.data.userRating === null || typeof res.data.userRating === "undefined") {
							try { delete myRatings[current.key]; } catch (e) { }
						} else {
							myRatings[current.key] = res.data.userRating;
						}
						applyFilter();
						if (visibleImages.length) {
							var pos = visibleImages.findIndex(function (im) { return im.key === current.key; });
							showByVisibleIndex(pos === -1 ? 0 : pos);
						} else {
							showByVisibleIndex(0);
						}
					}
				})
				.catch(function (e) {
					var msg = (e && e.message) ? e.message : "";
					if (msg.toLowerCase().indexOf("unauthorized") !== -1) {
						isLoggedIn = false;
						root.classList.toggle("is-logged-out", true);
						setStars(starsEl, null, false);
						avgEl.textContent = "Inicia sesión para evaluar";
						return;
					}
					avgEl.textContent = msg ? msg : "No se pudo guardar";
				});
		}

		createStars(starsEl, onSelectRating);
		// Siempre habilitado; el servidor responderá 401 si no corresponde.
		setStars(starsEl, null, false);

		nextBtn.addEventListener("click", function () {
			showByVisibleIndex(idx + 1);
		});
		prevBtn.addEventListener("click", function () {
			showByVisibleIndex(idx - 1);
		});

		root.addEventListener("click", function (e) {
			if (e.target && (e.target.closest(".avp-gallery__nav") || e.target.closest(".avp-gallery__stars"))) {
				return;
			}
			showByVisibleIndex(idx + 1);
		});

		document.addEventListener("keydown", function (e) {
			if (!root.isConnected) return;
			if (e.key === "ArrowRight") showByVisibleIndex(idx + 1);
			if (e.key === "ArrowLeft") showByVisibleIndex(idx - 1);
		});

		if (filterSelect) {
			filterSelect.addEventListener("change", function () {
				filterMode = filterSelect.value || "all";
				applyFilter();
				showByVisibleIndex(0);
			});
		}

		ensureAuthState().then(function () {
			return ensureImagesLoaded();
		}).then(function () {
			return ensureMyRatingsLoaded();
		}).then(function () {
			applyFilter();
			if (!visibleImages.length) return;
			showByVisibleIndex(0);
		});
	}

	function getStarsHtml(rating, gradientPrefix) {
		var html = "";
		var r = typeof rating === "number" ? rating : parseFloat(String(rating || "0")) || 0;

		for (var i = 1; i <= 5; i++) {
			if (i <= Math.floor(r)) {
				html += '<svg class="avp-ranking__star avp-ranking__star--filled" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>';
			} else if (i === Math.ceil(r) && r % 1 !== 0) {
				var id = String(gradientPrefix || "grad") + "-" + String(i);
				html += '<svg class="avp-ranking__star avp-ranking__star--filled" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
					'<defs><linearGradient id="' + id + '"><stop offset="50%" stop-color="#facc15" /><stop offset="50%" stop-color="transparent" stop-opacity="1" /></linearGradient></defs>' +
					'<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="url(#' + id + ')"></polygon></svg>';
			} else {
				html += '<svg class="avp-ranking__star avp-ranking__star--empty" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>';
			}
		}

		return html;
	}

	function initRanking(root) {
		var folder = root.getAttribute("data-folder") || "AdiosValparaiso";
		var list = root.querySelector(".avp-ranking__list");
		var errorBox = root.querySelector(".avp-ranking__error");
		var refreshBtn = root.querySelector(".avp-ranking__refresh");
		var refreshIcon = root.querySelector(".avp-ranking__refresh-icon");
		var year = root.querySelector(".avp-ranking__year");
		if (year) year.textContent = String(new Date().getFullYear());

		function setError(msg) {
			if (!errorBox) return;
			if (!msg) {
				errorBox.hidden = true;
				errorBox.textContent = "";
				return;
			}
			errorBox.hidden = false;
			errorBox.textContent = msg;
		}

		function render(items) {
			if (!list) return;
			list.innerHTML = "";

			if (!items || !items.length) {
				var empty = document.createElement("div");
				empty.className = "avp-ranking__empty";
				empty.textContent = "Aún no hay votos para mostrar.";
				list.appendChild(empty);
				return;
			}

			items.forEach(function (item, index) {
				var row = document.createElement("div");
				row.className = "avp-ranking__row";
				var rating = item && item.stats ? item.stats.avg : 0;
				var votes = item && item.stats ? item.stats.votes : 0;
				var safeName = document.createElement("div");
				safeName.textContent = (item && item.name) ? String(item.name) : "";

				row.innerHTML =
					'<div class="avp-ranking__pos">#' + (index + 1) + '</div>' +
					'<div class="avp-ranking__thumb"><img alt="" loading="lazy" src="' + (item.url || "") + '"></div>' +
					'<div class="avp-ranking__body">' +
					'  <div class="avp-ranking__name">' + safeName.innerHTML + '</div>' +
					'  <div class="avp-ranking__meta">' +
					'    <div class="avp-ranking__stars">' + getStarsHtml(rating, "avp-grad-" + String(index)) + '</div>' +
					'    <div class="avp-ranking__score">(' + (Math.round(rating * 10) / 10).toFixed(1) + ' · ' + votes + ')</div>' +
					'  </div>' +
					'</div>';

				list.appendChild(row);
			});
		}

		function load() {
			if (root.dataset.loading === "1") return;
			root.dataset.loading = "1";
			setError("");
			if (refreshIcon) refreshIcon.classList.add("is-spinning");
			if (refreshBtn) refreshBtn.disabled = true;

			ajax("avp_ranking", { folder: folder, limit: 50, minVotes: 1 })
				.then(function (res) {
					if (!res || !res.success) {
						var msg = (res && res.data && res.data.message) ? res.data.message : "No se pudo cargar el ranking";
						throw new Error(msg);
					}
					render((res.data && res.data.items) ? res.data.items : []);
				})
				.catch(function (e) {
					setError((e && e.message) ? e.message : "Hubo un problema cargando el ranking.");
					render([]);
				})
				.finally(function () {
					root.dataset.loading = "0";
					if (refreshIcon) refreshIcon.classList.remove("is-spinning");
					if (refreshBtn) refreshBtn.disabled = false;
				});
		}

		root.__avpLoad = function () {
			if (root.dataset.loaded === "1") return;
			root.dataset.loaded = "1";
			load();
		};

		if (refreshBtn) {
			refreshBtn.addEventListener("click", function () {
				root.dataset.loaded = "1";
				load();
			});
		}
	}

	function initGalleryModes(panel) {
		if (!panel) return;
		var slider = panel.querySelector(".avp-gallery");
		var thumbs = panel.querySelector(".avp-thumbs");
		var buttons = panel.querySelectorAll(".avp-gallery-modes__btn");
		if (!slider || !thumbs || !buttons.length) return;

		function setMode(mode) {
			var isThumbs = mode === "thumbs";
			thumbs.hidden = !isThumbs;
			slider.hidden = isThumbs;
			buttons.forEach(function (b) {
				b.classList.toggle("is-active", (b.dataset.galleryMode || "") === mode);
			});
			panel.dataset.galleryMode = mode;

			if (isThumbs && typeof thumbs.__avpEnsureInit === "function") {
				thumbs.__avpEnsureInit();
			}
		}

		buttons.forEach(function (b) {
			b.addEventListener("click", function () {
				setMode(b.dataset.galleryMode || "slider");
			});
		});

		setMode("slider");
	}

	function initThumbs(root) {
		var imagesJson = root.getAttribute("data-images") || "[]";
		var images;
		try { images = JSON.parse(imagesJson); } catch (e) { images = []; }
		var folder = root.getAttribute("data-folder") || "AdiosValparaiso";
		var source = root.getAttribute("data-source") || "uploads";

		var grid = root.querySelector(".avp-thumbs__grid");
		var sentinel = root.querySelector(".avp-thumbs__sentinel");
		var statusEl = root.querySelector(".avp-thumbs__status");
		var filterSelect = root.querySelector(".avp-thumbs__filter-select");

		var isLoggedIn = !!(window.AVP_GALLERY && window.AVP_GALLERY.isLoggedIn);
		if (getForcedLogin()) isLoggedIn = true;

		var allImages = images.slice();
		var visibleImages = images.slice();
		var myRatings = {};
		var filterMode = "all";

		var pageSize = 24;
		var renderedCount = 0;
		var loading = false;
		var observer = null;

		function setStatus(text) {
			if (!statusEl) return;
			statusEl.textContent = text || "";
		}

		function ensureImagesLoaded() {
			if (allImages.length) return Promise.resolve(allImages);
			if (source !== "r2") return Promise.resolve(allImages);

			setStatus("Cargando imágenes…");
			return ajax("avp_list_images", { folder: folder })
				.then(function (res) {
					if (!res || !res.success) throw new Error("failed");
					allImages = (res.data && res.data.images) ? res.data.images : [];
					return allImages;
				})
				.catch(function () {
					allImages = [];
					return allImages;
				});
		}

		function ensureMyRatingsLoaded() {
			if (!isLoggedIn) {
				myRatings = {};
				return Promise.resolve(myRatings);
			}
			if (!allImages.length) {
				myRatings = {};
				return Promise.resolve(myRatings);
			}
			var keys = allImages.map(function (im) { return im.key; }).filter(Boolean);
			if (!keys.length) {
				myRatings = {};
				return Promise.resolve(myRatings);
			}
			return ajax("avp_my_ratings", { imageKeys: keys })
				.then(function (res) {
					if (!res || !res.success) throw new Error("failed");
					myRatings = (res.data && res.data.ratings) ? res.data.ratings : {};
					return myRatings;
				})
				.catch(function () {
					myRatings = {};
					return myRatings;
				});
		}

		function applyFilter() {
			if (filterMode === "voted") {
				visibleImages = allImages.filter(function (im) {
					return Object.prototype.hasOwnProperty.call(myRatings || {}, im.key);
				});
			} else if (filterMode === "unvoted") {
				visibleImages = allImages.filter(function (im) {
					return !Object.prototype.hasOwnProperty.call(myRatings || {}, im.key);
				});
			} else {
				visibleImages = allImages.slice();
			}
			renderedCount = 0;
			if (grid) grid.innerHTML = "";
		}

		function createStarButton(value, currentValue, onClick) {
			var btn = document.createElement("button");
			btn.type = "button";
			btn.className = "avp-thumbs__star" + (value <= currentValue ? " is-on" : "");
			btn.setAttribute("aria-label", value + " estrellas");
			btn.textContent = "★";
			btn.addEventListener("click", function (e) {
				e.preventDefault();
				e.stopPropagation();
				onClick(value);
			});
			return btn;
		}

		function renderOneCard(item) {
			var card = document.createElement("div");
			card.className = "avp-thumbs__card";
			card.setAttribute("role", "listitem");

			var safeName = document.createElement("div");
			safeName.textContent = (item && item.name) ? String(item.name) : "";

			var currentRating = Object.prototype.hasOwnProperty.call(myRatings || {}, item.key) ? (parseInt(myRatings[item.key], 10) || 0) : 0;

			card.innerHTML =
				'<div class="avp-thumbs__img"><img loading="lazy" alt="" src="' + (item.url || "") + '"></div>' +
				'<div class="avp-thumbs__body">' +
				'  <div class="avp-thumbs__title">' + safeName.innerHTML + '</div>' +
				'  <div class="avp-thumbs__rating" aria-label="Tu evaluación"></div>' +
				'</div>';

			var ratingEl = card.querySelector(".avp-thumbs__rating");
			if (ratingEl) {
				ratingEl.innerHTML = "";
				for (var i = 1; i <= 5; i++) {
					ratingEl.appendChild(createStarButton(i, currentRating, function (val) {
						setStatus("Guardando…");
						ajax("avp_set_rating", { imageKey: item.key, imageUrl: item.url, rating: String(val) })
							.then(function (res) {
								if (!res || !res.success) throw new Error("failed");
								myRatings[item.key] = res.data.userRating;
								applyFilter();
								renderMore();
								setStatus("");
							})
							.catch(function () {
								setStatus("No se pudo guardar");
								setTimeout(function () { setStatus(""); }, 1200);
							});
					}));
				}
			}

			return card;
		}

		function renderMore() {
			if (!grid) return;
			if (loading) return;
			loading = true;

			var next = visibleImages.slice(renderedCount, renderedCount + pageSize);
			next.forEach(function (item) {
				grid.appendChild(renderOneCard(item));
			});
			renderedCount += next.length;

			if (renderedCount >= visibleImages.length) {
				setStatus(visibleImages.length ? "" : "No hay imágenes para este filtro");
			}

			loading = false;
		}

		function setupObserver() {
			if (!sentinel) return;
			if (observer) observer.disconnect();
			observer = new IntersectionObserver(function (entries) {
				entries.forEach(function (e) {
					if (e.isIntersecting) renderMore();
				});
			}, { rootMargin: "600px 0px" });
			observer.observe(sentinel);
		}

		function initNow() {
			return ensureImagesLoaded()
				.then(function () { return ensureMyRatingsLoaded(); })
				.then(function () {
					applyFilter();
					renderMore();
					setupObserver();
					setStatus("");
				});
		}

		root.__avpEnsureInit = function () {
			if (root.dataset.inited === "1") return;
			root.dataset.inited = "1";
			initNow();
		};

		if (filterSelect) {
			filterSelect.addEventListener("change", function () {
				filterMode = filterSelect.value || "all";
				applyFilter();
				renderMore();
			});
		}
	}

	document.addEventListener("DOMContentLoaded", function () {
		document.querySelectorAll(".avp-gallery-shell").forEach(initShell);
		document.querySelectorAll(".avp-gallery").forEach(initGallery);
		document.querySelectorAll(".avp-ranking").forEach(initRanking);
		document.querySelectorAll(".avp-gallery-shell__panel[data-panel='gallery']").forEach(initGalleryModes);
		document.querySelectorAll(".avp-thumbs").forEach(initThumbs);
	});
})();
