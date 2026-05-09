<?php
/**
 * Plugin Name: Adios Valparaiso Gallery
 * Description: Shortcode para mostrar una galería fullscreen desde la carpeta "AdiosValparaiso" y permitir votación 0–5 estrellas por usuarios logeados.
 * Version: 0.1.0
 * Author: Codex
 */

if (!defined('ABSPATH')) {
	exit;
}

define('AVP_GALLERY_VERSION', '0.1.16');
define('AVP_GALLERY_PLUGIN_FILE', __FILE__);
define('AVP_GALLERY_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('AVP_GALLERY_PLUGIN_URL', plugin_dir_url(__FILE__));

require_once AVP_GALLERY_PLUGIN_DIR . 'includes/class-avp-gallery-db.php';
require_once AVP_GALLERY_PLUGIN_DIR . 'includes/class-avp-gallery-settings.php';
require_once AVP_GALLERY_PLUGIN_DIR . 'includes/class-avp-gallery-r2.php';
require_once AVP_GALLERY_PLUGIN_DIR . 'includes/class-avp-gallery.php';

register_activation_hook(__FILE__, array('AVP_Gallery_DB', 'activate'));

add_action('plugins_loaded', function () {
	AVP_Gallery::init();
});
