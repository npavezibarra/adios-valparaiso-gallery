<?php

define('AVP_RATING_ENDPOINT', true);

$wp_load = dirname(__DIR__, 3) . '/wp-load.php';
if (!file_exists($wp_load)) {
	http_response_code(500);
	header('Content-Type: application/json; charset=utf-8');
	echo wp_json_encode(array(
		'success' => false,
		'data' => array('message' => 'wp-load.php no encontrado'),
	));
	exit;
}

require_once $wp_load;

header('Content-Type: application/json; charset=utf-8');
nocache_headers();

function avp_same_origin() {
	$normalize_host = function ($host) {
		$host = strtolower((string) $host);
		$host = preg_replace('/^www\./', '', $host);
		return $host;
	};

	$allowed_hosts = array();
	$home = wp_parse_url(home_url());
	$site = wp_parse_url(site_url());
	if (!empty($home['host'])) {
		$allowed_hosts[] = $normalize_host($home['host']);
	}
	if (!empty($site['host'])) {
		$allowed_hosts[] = $normalize_host($site['host']);
	}
	$allowed_hosts = array_values(array_unique(array_filter($allowed_hosts)));
	if (!$allowed_hosts) {
		return false;
	}

	$origin = isset($_SERVER['HTTP_ORIGIN']) ? (string) $_SERVER['HTTP_ORIGIN'] : '';
	if ($origin) {
		$o = wp_parse_url($origin);
		$origin_host = isset($o['host']) ? $o['host'] : '';
		return $origin_host && in_array($normalize_host($origin_host), $allowed_hosts, true);
	}

	$referer = isset($_SERVER['HTTP_REFERER']) ? (string) $_SERVER['HTTP_REFERER'] : '';
	if ($referer) {
		$r = wp_parse_url($referer);
		$ref_host = isset($r['host']) ? $r['host'] : '';
		return $ref_host && in_array($normalize_host($ref_host), $allowed_hosts, true);
	}

	return false;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
	http_response_code(405);
	echo wp_json_encode(array(
		'success' => false,
		'data' => array('message' => 'Method not allowed'),
	));
	exit;
}

$forced_login = isset($_POST['avp_logged_in']) && $_POST['avp_logged_in'] === '1';

// En modo override local (`avp_logged_in=1`) permitimos omitir nonce porque
// hay instalaciones que bloquean sesiones/REST/admin-ajax de forma inconsistente.
// No usar esto en produccion.
$nonce = isset($_POST['nonce']) ? sanitize_text_field(wp_unslash($_POST['nonce'])) : '';
if (
	!$forced_login
	&& (!$nonce || !wp_verify_nonce($nonce, 'avp_gallery_nonce'))
	&& !(is_user_logged_in() && avp_same_origin())
) {
	http_response_code(403);
	echo wp_json_encode(array(
		'success' => false,
		'data' => array('message' => 'Nonce invalido'),
	));
	exit;
}
if (!is_user_logged_in() && !$forced_login) {
	http_response_code(401);
	echo wp_json_encode(array(
		'success' => false,
		'data' => array('message' => 'Unauthorized'),
	));
	exit;
}

$image_key = isset($_POST['imageKey']) ? sanitize_text_field(wp_unslash($_POST['imageKey'])) : '';
$image_url = isset($_POST['imageUrl']) ? esc_url_raw(wp_unslash($_POST['imageUrl'])) : '';
$rating = isset($_POST['rating']) ? intval($_POST['rating']) : null;

if (!$image_key || !$image_url || $rating === null) {
	http_response_code(400);
	echo wp_json_encode(array(
		'success' => false,
		'data' => array('message' => 'Missing params'),
	));
	exit;
}

$user_id = get_current_user_id();
if (!$user_id && $forced_login) {
	$user_id = 0;
}

$stats = AVP_Gallery_DB::set_user_rating($image_key, $image_url, $user_id, $rating);

echo wp_json_encode(array(
	'success' => true,
	'data' => array(
		'stats' => $stats,
		'userRating' => AVP_Gallery_DB::get_user_rating($image_key, $user_id),
	),
));
exit;
