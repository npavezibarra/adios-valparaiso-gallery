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
				break;
			}
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

		var isLoggedIn = !!(window.AVP_GALLERY && window.AVP_GALLERY.isLoggedIn);
		if (getForcedLogin()) isLoggedIn = true;
		// No confies en isLoggedIn inicial (puede venir cacheado). No mostramos el hint por defecto.
		root.classList.remove("is-logged-out");

		var idx = 0;
		var current = null;

		function ensureAuthState() {
			var cfg = (window.AVP_GALLERY || {});
			if (getForcedLogin()) {
				isLoggedIn = true;
				root.classList.toggle("is-logged-out", false);
				setStars(starsEl, null, false);
				return Promise.resolve(true);
			}
			if (!cfg.restUrl) return Promise.resolve(isLoggedIn);
			var url = cfg.restUrl.replace(/\/$/, "") + "/me";
			url = withForcedParam(url);
			return fetch(url, {
				credentials: "same-origin",
				headers: { "X-WP-Nonce": cfg.restNonce || "" },
			})
				.then(function (r) { return r.json(); })
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
				.catch(function () {
					return isLoggedIn;
				});
		}

		function ensureImagesLoaded() {
			if (images.length) return Promise.resolve(images);
			if (source !== "r2") return Promise.resolve(images);

			avgEl.textContent = "Cargando imágenes…";
			return ajax("avp_list_images", { folder: folder })
				.then(function (res) {
					if (!res || !res.success) {
						var msg = (res && res.data && res.data.message) ? res.data.message : "failed";
						throw new Error(msg);
					}
					images = res.data.images || [];
					return images;
				})
				.catch(function (e) {
					avgEl.textContent = e && e.message ? e.message : "No se pudieron cargar imágenes";
					images = [];
					return images;
				});
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
			ensureImagesLoaded().then(function () {
				if (!images.length) return;
				if (i < 0) i = images.length - 1;
				if (i >= images.length) i = 0;
				idx = i;
				current = images[idx];
				imgEl.src = current.url;
				counterEl.textContent = (idx + 1) + " / " + images.length;
				filenameEl.textContent = current.name || "";
				loadRatingsForCurrent();
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
			show(idx + 1);
		});
		prevBtn.addEventListener("click", function () {
			show(idx - 1);
		});

		root.addEventListener("click", function (e) {
			if (e.target && (e.target.closest(".avp-gallery__nav") || e.target.closest(".avp-gallery__stars"))) {
				return;
			}
			show(idx + 1);
		});

		document.addEventListener("keydown", function (e) {
			if (!root.isConnected) return;
			if (e.key === "ArrowRight") show(idx + 1);
			if (e.key === "ArrowLeft") show(idx - 1);
		});

		ensureAuthState().then(function () {
			return ensureImagesLoaded();
		}).then(function () {
			if (!images.length) return;
			show(0);
		});
	}

	document.addEventListener("DOMContentLoaded", function () {
		document.querySelectorAll(".avp-gallery").forEach(initGallery);
	});
})();
