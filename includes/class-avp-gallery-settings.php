<?php

if (!defined('ABSPATH')) {
	exit;
}

class AVP_Gallery_Settings {
	const OPTION_KEY = 'avp_gallery_r2';
	const PAGE_SLUG = 'avp-gallery-r2';

	public static function init() {
		add_action('admin_menu', array(__CLASS__, 'add_menu'));
		add_action('admin_init', array(__CLASS__, 'register_settings'));
	}

	public static function add_menu() {
		add_options_page(
			'Adios Valparaiso Gallery (R2)',
			'AVP Gallery (R2)',
			'manage_options',
			self::PAGE_SLUG,
			array(__CLASS__, 'render_page')
		);
	}

	public static function register_settings() {
		register_setting(self::OPTION_KEY, self::OPTION_KEY, array(
			'type' => 'array',
			'sanitize_callback' => array(__CLASS__, 'sanitize'),
			'default' => array(),
		));

		add_settings_section(
			'avp_r2_main',
			'Credenciales Cloudflare R2',
			function () {
				echo '<p>Guarda aquí las credenciales para listar objetos en tu bucket R2 (S3-compatible). Estas credenciales quedan en tu base de datos de WordPress (tabla <code>wp_options</code>).</p>';
			},
			self::PAGE_SLUG
		);

		$fields = array(
			'enabled' => array('Habilitar R2', 'checkbox'),
			'account_id' => array('Account ID', 'text'),
			'bucket' => array('Bucket', 'text'),
			'prefix' => array('Prefix (carpeta)', 'text'),
			'access_key_id' => array('Access Key ID', 'text'),
			'secret_access_key' => array('Secret Access Key', 'password'),
			'endpoint' => array('Endpoint (opcional)', 'text'),
			'public_base_url' => array('Public Base URL (opcional)', 'text'),
			'presign' => array('Usar URLs firmadas (bucket privado)', 'checkbox'),
			'presign_expires' => array('Expiración firma (segundos)', 'number'),
		);

		foreach ($fields as $key => $meta) {
			add_settings_field(
				'avp_r2_' . $key,
				esc_html($meta[0]),
				array(__CLASS__, 'render_field'),
				self::PAGE_SLUG,
				'avp_r2_main',
				array(
					'key' => $key,
					'type' => $meta[1],
				)
			);
		}
	}

	public static function sanitize($value) {
		$value = is_array($value) ? $value : array();

		$out = array();
		$out['enabled'] = !empty($value['enabled']) ? 1 : 0;
		$out['account_id'] = isset($value['account_id']) ? sanitize_text_field($value['account_id']) : '';
		$out['bucket'] = isset($value['bucket']) ? sanitize_text_field($value['bucket']) : '';
		$out['prefix'] = isset($value['prefix']) ? trim(sanitize_text_field($value['prefix'])) : '';
		$out['access_key_id'] = isset($value['access_key_id']) ? sanitize_text_field($value['access_key_id']) : '';

		// Si no entregan nuevo secret, mantenemos el actual.
		$current = self::get();
		$new_secret = isset($value['secret_access_key']) ? (string) $value['secret_access_key'] : '';
		$new_secret = trim($new_secret);
		if ($new_secret === '' && !empty($current['secret_access_key'])) {
			$out['secret_access_key'] = $current['secret_access_key'];
		} else {
			$out['secret_access_key'] = $new_secret;
		}

		$out['endpoint'] = isset($value['endpoint']) ? esc_url_raw($value['endpoint']) : '';
		$out['public_base_url'] = isset($value['public_base_url']) ? esc_url_raw($value['public_base_url']) : '';
		$out['presign'] = !empty($value['presign']) ? 1 : 0;

		$expires = isset($value['presign_expires']) ? intval($value['presign_expires']) : 3600;
		if ($expires < 60) {
			$expires = 60;
		}
		if ($expires > 604800) {
			$expires = 604800;
		}
		$out['presign_expires'] = $expires;

		return $out;
	}

	public static function get() {
		$opt = get_option(self::OPTION_KEY, array());
		return is_array($opt) ? $opt : array();
	}

	public static function render_field($args) {
		$key = $args['key'];
		$type = $args['type'];
		$opt = self::get();
		$val = isset($opt[$key]) ? $opt[$key] : '';

		$name = self::OPTION_KEY . '[' . esc_attr($key) . ']';

		if ($type === 'checkbox') {
			printf(
				'<input type="checkbox" name="%s" value="1" %s />',
				esc_attr($name),
				checked(!empty($val), true, false)
			);
			return;
		}

		$attrs = '';
		if ($type === 'number') {
			$attrs = ' step="1" min="60" max="604800"';
		}

		$display = $val;
		if ($type === 'password') {
			$display = '';
		}

		printf(
			'<input class="regular-text" type="%s" name="%s" value="%s"%s />',
			esc_attr($type),
			esc_attr($name),
			esc_attr($display),
			$attrs
		);

		if ($type === 'password' && !empty($val)) {
			echo '<p class="description">Secret guardado. Para cambiarlo, pega uno nuevo y guarda.</p>';
		}
	}

	public static function render_page() {
		if (!current_user_can('manage_options')) {
			return;
		}

		echo '<div class="wrap">';
		echo '<h1>Adios Valparaiso Gallery — Cloudflare R2</h1>';
		echo '<form method="post" action="options.php">';
		settings_fields(self::OPTION_KEY);
		do_settings_sections(self::PAGE_SLUG);
		submit_button('Guardar');
		echo '</form>';
		echo '<hr />';
		echo '<p><strong>Uso:</strong> en el shortcode usa <code>source="r2"</code>. Ej: <code>[adios_valparaiso_gallery source="r2"]</code>.</p>';
		echo '</div>';
	}
}

