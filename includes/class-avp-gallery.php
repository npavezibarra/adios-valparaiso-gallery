<?php

if (!defined('ABSPATH')) {
	exit;
}

class AVP_Gallery {
	const SHORTCODE = 'adios_valparaiso_gallery';

	public static function init() {
		AVP_Gallery_Settings::init();
		add_shortcode(self::SHORTCODE, array(__CLASS__, 'render_shortcode'));
		add_action('wp_enqueue_scripts', array(__CLASS__, 'register_assets'));
		add_action('rest_api_init', array(__CLASS__, 'register_rest_routes'));
		add_action('wp_ajax_avp_get_rating', array(__CLASS__, 'ajax_get_rating'));
		add_action('wp_ajax_nopriv_avp_get_rating', array(__CLASS__, 'ajax_get_rating'));
		add_action('wp_ajax_avp_set_rating', array(__CLASS__, 'ajax_set_rating'));
		add_action('wp_ajax_avp_list_images', array(__CLASS__, 'ajax_list_images'));
		add_action('wp_ajax_nopriv_avp_list_images', array(__CLASS__, 'ajax_list_images'));
	}

	public static function register_rest_routes() {
		register_rest_route('avp/v1', '/me', array(
			'methods' => 'GET',
			'permission_callback' => '__return_true',
			'callback' => array(__CLASS__, 'rest_me'),
		));

		register_rest_route('avp/v1', '/list-images', array(
			'methods' => 'GET',
			'permission_callback' => '__return_true',
			'callback' => array(__CLASS__, 'rest_list_images'),
			'args' => array(
				'folder' => array(
					'type' => 'string',
					'required' => false,
				),
			),
		));

		register_rest_route('avp/v1', '/rating', array(
			'methods' => 'GET',
			'permission_callback' => '__return_true',
			'callback' => array(__CLASS__, 'rest_get_rating'),
			'args' => array(
				'imageKey' => array(
					'type' => 'string',
					'required' => true,
				),
			),
		));

		register_rest_route('avp/v1', '/rating', array(
			'methods' => 'POST',
			'permission_callback' => function () {
				if (self::is_logged_in_request()) {
					return true;
				}
				// Permite override controlado vía nonce propio del plugin (para entornos locales donde REST auth falla).
				$nonce = '';
				if (function_exists('getallheaders')) {
					$headers = getallheaders();
					if (isset($headers['X-AVP-Nonce'])) {
						$nonce = (string) $headers['X-AVP-Nonce'];
					}
				}
				if ($nonce === '' && isset($_REQUEST['avp_nonce'])) {
					$nonce = (string) $_REQUEST['avp_nonce'];
				}
				return $nonce ? wp_verify_nonce($nonce, 'avp_gallery_nonce') : false;
			},
			'callback' => array(__CLASS__, 'rest_set_rating'),
			'args' => array(
				'imageKey' => array(
					'type' => 'string',
					'required' => true,
				),
				'imageUrl' => array(
					'type' => 'string',
					'required' => true,
				),
				'rating' => array(
					'type' => 'integer',
					'required' => true,
				),
			),
		));
	}

	public static function register_assets() {
		wp_register_style(
			'avp-gallery',
			AVP_GALLERY_PLUGIN_URL . 'assets/css/gallery.css',
			array(),
			AVP_GALLERY_VERSION
		);

		wp_register_script(
			'avp-gallery',
			AVP_GALLERY_PLUGIN_URL . 'assets/js/gallery.js',
			array(),
			AVP_GALLERY_VERSION,
			true
		);
	}

	private static function is_logged_in_request() {
		// Algunos setups pueden no propagar auth cookies al REST API.
		// Permitimos override explícito via query param para entornos locales/controlados.
		if (isset($_GET['avp_logged_in']) && $_GET['avp_logged_in'] === '1') {
			return true;
		}
		return is_user_logged_in();
	}

	private static function resolve_gallery_dir($atts) {
		$atts = shortcode_atts(
			array(
				'source' => 'uploads',
				'folder' => 'AdiosValparaiso',
			),
			$atts,
			self::SHORTCODE
		);

		$source = sanitize_text_field($atts['source']);
		$source = strtolower(trim($source));

		$folder = sanitize_text_field($atts['folder']);
		$folder = trim($folder, "/ \t\n\r\0\x0B");
		if ($folder === '') {
			$folder = 'AdiosValparaiso';
		}

		if ($source === 'r2') {
			return array(
				'origin' => 'r2',
				'folder' => $folder,
			);
		}

		$upload = wp_upload_dir();
		$uploads_basedir = isset($upload['basedir']) ? $upload['basedir'] : '';
		$uploads_baseurl = isset($upload['baseurl']) ? $upload['baseurl'] : '';

		$candidates = array();

		if ($uploads_basedir && $source !== 'plugin') {
			$candidates[] = array(
				'dir' => trailingslashit($uploads_basedir) . $folder,
				'url' => trailingslashit($uploads_baseurl) . $folder,
				'origin' => 'uploads',
				'folder' => $folder,
			);
		}

		if ($source !== 'uploads') {
			$candidates[] = array(
				'dir' => trailingslashit(AVP_GALLERY_PLUGIN_DIR) . $folder,
				'url' => trailingslashit(AVP_GALLERY_PLUGIN_URL) . $folder,
				'origin' => 'plugin',
				'folder' => $folder,
			);
		}

		foreach ($candidates as $c) {
			if (!empty($c['dir']) && is_dir($c['dir'])) {
				return $c;
			}
		}

		return null;
	}

	private static function list_images($dir_info) {
		if (isset($dir_info['origin']) && $dir_info['origin'] === 'r2') {
			$settings = AVP_Gallery_Settings::get();
			if (empty($settings['enabled'])) {
				return array();
			}

			$base_prefix = isset($settings['prefix']) ? (string) $settings['prefix'] : '';
			$folder = isset($dir_info['folder']) ? (string) $dir_info['folder'] : '';
			$folder = trim($folder);

			$prefixes = array();
			$base_prefix_norm = trim($base_prefix, '/');
			if ($folder !== '') {
				$folder_norm = trim($folder, '/');
				$prefixes[] = ($base_prefix_norm !== '' ? $base_prefix_norm . '/' : '') . $folder_norm;
			}
			$prefixes[] = $base_prefix_norm;

			$keys = null;
			foreach ($prefixes as $p) {
				$keys = AVP_Gallery_R2::list_images($settings, $p);
				if (is_wp_error($keys)) {
					break;
				}
				if (!empty($keys)) {
					break;
				}
			}
			if (is_wp_error($keys)) {
				return array();
			}

			$images = array();
			foreach ($keys as $key) {
				$lower = strtolower($key);
				if (!preg_match('/\.(jpe?g|png|webp|gif)$/', $lower)) {
					continue;
				}

				$basename = wp_basename($key);
				$image_ref = 'r2/' . $settings['bucket'] . '/' . $key;
				$image_key = sha1($image_ref);

				$url = '';
				if (!empty($settings['presign'])) {
					$url = AVP_Gallery_R2::presign_get($settings, $key, isset($settings['presign_expires']) ? $settings['presign_expires'] : 3600);
				} else {
					$url = AVP_Gallery_R2::object_url($settings, $key);
				}

				if (!$url) {
					continue;
				}

				$images[] = array(
					'key' => $image_key,
					'url' => esc_url_raw($url),
					'path' => $key,
					'name' => $basename,
				);
			}

			return $images;
		}

		$dir = $dir_info['dir'];
		$url = $dir_info['url'];
		$origin = isset($dir_info['origin']) ? $dir_info['origin'] : 'unknown';
		$folder = isset($dir_info['folder']) ? $dir_info['folder'] : '';

		$patterns = array('*.jpg', '*.jpeg', '*.png', '*.webp', '*.gif', '*.JPG', '*.JPEG', '*.PNG', '*.WEBP', '*.GIF');
		$files = array();
		foreach ($patterns as $p) {
			$matches = glob(trailingslashit($dir) . $p);
			if (is_array($matches)) {
				$files = array_merge($files, $matches);
			}
		}

		$files = array_values(array_unique($files));
		sort($files, SORT_NATURAL | SORT_FLAG_CASE);

		$images = array();
		foreach ($files as $path) {
			$basename = wp_basename($path);
			$public_url = trailingslashit($url) . rawurlencode($basename);
			// Key estable independiente del dominio (migraciones), basado en origen/carpeta/archivo.
			$image_ref = $origin . '/' . $folder . '/' . $basename;
			$image_key = sha1($image_ref);
			$images[] = array(
				'key' => $image_key,
				'url' => esc_url_raw($public_url),
				'path' => $path,
				'name' => $basename,
			);
		}

		return $images;
	}

	public static function render_shortcode($atts) {
		// Gate: la galería es solo para usuarios logeados.
		// En producción algunos caches pueden mentir sobre el estado, pero el endpoint del plugin confirmará.
		if (!is_user_logged_in()) {
			wp_enqueue_style('avp-gallery');
			wp_enqueue_script('avp-gallery');

			$localize = array(
				'ajaxUrl' => admin_url('admin-ajax.php'),
				'directRatingUrl' => plugins_url('avp-rating-endpoint.php', AVP_GALLERY_PLUGIN_FILE),
				'nonce' => wp_create_nonce('avp_gallery_nonce'),
				'isLoggedIn' => false,
				'restUrl' => rest_url('avp/v1', 'relative'),
				'restNonce' => wp_create_nonce('wp_rest'),
				'loginUrl' => wp_login_url((string) get_permalink()),
				'registerUrl' => function_exists('wp_registration_url') ? wp_registration_url() : wp_login_url((string) get_permalink()),
			);
			wp_add_inline_script('avp-gallery', 'window.AVP_GALLERY = ' . wp_json_encode($localize) . ';', 'before');

			$html  = '<div class="avp-gallery avp-gallery--locked" data-locked="1">';
			$html .= '  <div class="avp-gallery__lock">';
			$html .= '    <div class="avp-gallery__lock-card">';
			$html .= '      <div class="avp-gallery__lock-title">Acceso restringido</div>';
			$html .= '      <div class="avp-gallery__lock-msg">Esta galería es solo para usuarios con sesión iniciada.</div>';
			$html .= '      <button class="avp-gallery__login-btn" type="button">INGRESAR</button>';
			$html .= '    </div>';
			$html .= '  </div>';
			$html .= '</div>';

			return $html;
		}

		$atts = shortcode_atts(
			array(
				'source' => 'uploads',
				'folder' => 'AdiosValparaiso',
			),
			$atts,
			self::SHORTCODE
		);

		$dir_info = self::resolve_gallery_dir($atts);
		if (!$dir_info) {
			return '<div class="avp-gallery__error">No se encontró la carpeta de imágenes. Crea <code>wp-content/uploads/AdiosValparaiso</code> (recomendado) o una carpeta <code>AdiosValparaiso</code> dentro del plugin.</div>';
		}

		wp_enqueue_style('avp-gallery');
		wp_enqueue_script('avp-gallery');

		$source = strtolower(trim(sanitize_text_field($atts['source'])));
		$folder = trim(sanitize_text_field($atts['folder']));

		$payload_images = array();
		if ($source !== 'r2') {
			$images = self::list_images($dir_info);
			if (empty($images)) {
				return '<div class="avp-gallery__error">No se encontraron imágenes en la carpeta.</div>';
			}
			$payload_images = array_map(function ($img) {
				return array(
					'key' => $img['key'],
					'url' => $img['url'],
					'name' => $img['name'],
				);
			}, $images);
		}

		$localize = array(
			'ajaxUrl' => admin_url('admin-ajax.php'),
			'directRatingUrl' => plugins_url('avp-rating-endpoint.php', AVP_GALLERY_PLUGIN_FILE),
			'nonce' => wp_create_nonce('avp_gallery_nonce'),
			'isLoggedIn' => self::is_logged_in_request(),
			// Usa URL relativa para evitar mismatch http/https y cookies no enviadas.
			'restUrl' => rest_url('avp/v1', 'relative'),
			'restNonce' => wp_create_nonce('wp_rest'),
		);

		wp_add_inline_script('avp-gallery', 'window.AVP_GALLERY = ' . wp_json_encode($localize) . ';', 'before');

		$html  = '<div class="avp-gallery" data-images="' . esc_attr(wp_json_encode($payload_images)) . '" data-source="' . esc_attr($source) . '" data-folder="' . esc_attr($folder) . '">';
		$html .= '  <button class="avp-gallery__nav avp-gallery__nav--prev" type="button" aria-label="Previous">‹</button>';
		$html .= '  <button class="avp-gallery__nav avp-gallery__nav--next" type="button" aria-label="Next">›</button>';
		$html .= '  <div class="avp-gallery__stage" role="group" aria-label="Gallery">';
		$html .= '    <img class="avp-gallery__img" alt="" />';
		$html .= '  </div>';
		$html .= '  <div class="avp-gallery__hud">';
		$html .= '    <div class="avp-gallery__meta">';
		$html .= '      <div class="avp-gallery__counter"></div>';
		$html .= '      <div class="avp-gallery__filename"></div>';
		$html .= '    </div>';
		$html .= '    <div class="avp-gallery__rating">';
		$html .= '      <div class="avp-gallery__avg" aria-live="polite"></div>';
		$html .= '      <div class="avp-gallery__stars" role="radiogroup" aria-label="Tu evaluación (0 a 5)"></div>';
		$html .= '      <div class="avp-gallery__login-hint">Inicia sesión para evaluar.</div>';
		$html .= '    </div>';
		$html .= '  </div>';
		$html .= '</div>';

		return $html;
	}

	public static function ajax_list_images() {
		check_ajax_referer('avp_gallery_nonce', 'nonce');

		$folder = isset($_POST['folder']) ? sanitize_text_field(wp_unslash($_POST['folder'])) : 'AdiosValparaiso';
		$dir_info = array(
			'origin' => 'r2',
			'folder' => $folder,
		);

		$images = self::list_images($dir_info);
		$settings = AVP_Gallery_Settings::get();
		if (empty($settings['enabled'])) {
			wp_send_json_error(array('message' => 'R2 deshabilitado'), 400);
		}
		if (empty($settings['bucket']) || empty($settings['access_key_id']) || empty($settings['secret_access_key']) || (empty($settings['account_id']) && empty($settings['endpoint']))) {
			wp_send_json_error(array('message' => 'R2 no configurado'), 400);
		}
		if (empty($images)) {
			wp_send_json_error(array('message' => 'Sin imágenes o no se pudo listar'), 404);
		}

		$payload_images = array();
		foreach ($images as $img) {
			$payload_images[] = array(
				'key' => $img['key'],
				'url' => $img['url'],
				'name' => $img['name'],
			);
		}

		wp_send_json_success(array('images' => $payload_images));
	}

	public static function ajax_get_rating() {
		check_ajax_referer('avp_gallery_nonce', 'nonce');

		$image_key = isset($_POST['imageKey']) ? sanitize_text_field(wp_unslash($_POST['imageKey'])) : '';
		if (!$image_key) {
			wp_send_json_error(array('message' => 'Missing imageKey'), 400);
		}

		$stats = AVP_Gallery_DB::get_stats($image_key);
		$user_rating = null;
		if (is_user_logged_in()) {
			$user_rating = AVP_Gallery_DB::get_user_rating($image_key, get_current_user_id());
		}

		wp_send_json_success(array(
			'stats' => $stats,
			'userRating' => $user_rating,
		));
	}

	public static function ajax_set_rating() {
		check_ajax_referer('avp_gallery_nonce', 'nonce');

		if (!is_user_logged_in()) {
			wp_send_json_error(array('message' => 'Unauthorized'), 401);
		}

		$image_key = isset($_POST['imageKey']) ? sanitize_text_field(wp_unslash($_POST['imageKey'])) : '';
		$image_url = isset($_POST['imageUrl']) ? esc_url_raw(wp_unslash($_POST['imageUrl'])) : '';
		$rating = isset($_POST['rating']) ? intval($_POST['rating']) : null;

		if (!$image_key || !$image_url || $rating === null) {
			wp_send_json_error(array('message' => 'Missing params'), 400);
		}

		$stats = AVP_Gallery_DB::set_user_rating($image_key, $image_url, get_current_user_id(), $rating);

		wp_send_json_success(array(
			'stats' => $stats,
			'userRating' => AVP_Gallery_DB::get_user_rating($image_key, get_current_user_id()),
		));
	}

	public static function rest_list_images($request) {
		$folder = (string) $request->get_param('folder');
		$folder = $folder !== '' ? sanitize_text_field($folder) : 'AdiosValparaiso';

		$dir_info = array(
			'origin' => 'r2',
			'folder' => $folder,
		);

		$images = self::list_images($dir_info);
		$settings = AVP_Gallery_Settings::get();
		if (empty($settings['enabled'])) {
			return new WP_REST_Response(array('success' => false, 'data' => array('message' => 'R2 deshabilitado')), 400);
		}
		if (empty($settings['bucket']) || empty($settings['access_key_id']) || empty($settings['secret_access_key']) || (empty($settings['account_id']) && empty($settings['endpoint']))) {
			return new WP_REST_Response(array('success' => false, 'data' => array('message' => 'R2 no configurado')), 400);
		}
		if (empty($images)) {
			return new WP_REST_Response(array('success' => false, 'data' => array('message' => 'Sin imágenes o no se pudo listar')), 404);
		}

		$payload_images = array();
		foreach ($images as $img) {
			$payload_images[] = array(
				'key' => $img['key'],
				'url' => $img['url'],
				'name' => $img['name'],
			);
		}

		return new WP_REST_Response(array('success' => true, 'data' => array('images' => $payload_images)), 200);
	}

	public static function rest_me($request) {
		return new WP_REST_Response(array(
			'success' => true,
			'data' => array(
				'isLoggedIn' => self::is_logged_in_request(),
			),
		), 200);
	}

	public static function rest_get_rating($request) {
		$image_key = (string) $request->get_param('imageKey');
		$image_key = sanitize_text_field($image_key);
		if (!$image_key) {
			return new WP_REST_Response(array('success' => false, 'data' => array('message' => 'Missing imageKey')), 400);
		}

		$stats = AVP_Gallery_DB::get_stats($image_key);
		$user_rating = null;
		if (is_user_logged_in()) {
			$user_rating = AVP_Gallery_DB::get_user_rating($image_key, get_current_user_id());
		}

		return new WP_REST_Response(array(
			'success' => true,
			'data' => array(
				'stats' => $stats,
				'userRating' => $user_rating,
				'isLoggedIn' => self::is_logged_in_request(),
			),
		), 200);
	}

	public static function rest_set_rating($request) {
		if (!self::is_logged_in_request()) {
			return new WP_REST_Response(array('success' => false, 'data' => array('message' => 'Unauthorized')), 401);
		}

		$image_key = sanitize_text_field((string) $request->get_param('imageKey'));
		$image_url = esc_url_raw((string) $request->get_param('imageUrl'));
		$rating = intval($request->get_param('rating'));

		if (!$image_key || !$image_url) {
			return new WP_REST_Response(array('success' => false, 'data' => array('message' => 'Missing params')), 400);
		}

		$user_id = get_current_user_id();
		if (!$user_id) {
			// REST sin cookies: si llegamos aquí es por override, usamos 0.
			$user_id = 0;
		}
		$stats = AVP_Gallery_DB::set_user_rating($image_key, $image_url, $user_id, $rating);

		return new WP_REST_Response(array(
			'success' => true,
			'data' => array(
				'stats' => $stats,
				'userRating' => AVP_Gallery_DB::get_user_rating($image_key, get_current_user_id()),
			),
		), 200);
	}
}
