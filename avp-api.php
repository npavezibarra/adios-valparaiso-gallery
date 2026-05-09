<?php

/**
 * Lightweight same-origin API endpoint for the gallery.
 *
 * Why: some production stacks (Cloudflare/WAF/full-page cache) break wp-json or wp-admin/admin-ajax
 * for logged-in users due to nonce/session mismatches. This endpoint runs inside WP (via wp-load)
 * and relies on WordPress cookies plus same-origin checks.
 */

define('AVP_GALLERY_API', true);

$wp_load = dirname(__DIR__, 3) . '/wp-load.php';
if (!file_exists($wp_load)) {
	http_response_code(500);
	header('Content-Type: application/json; charset=utf-8');
	echo json_encode(array('success' => false, 'data' => array('message' => 'wp-load.php no encontrado')));
	exit;
}

require_once $wp_load;

header('Content-Type: application/json; charset=utf-8');
nocache_headers();

function avp_api_normalize_host($host) {
	$host = strtolower((string) $host);
	$host = preg_replace('/^www\./', '', $host);
	return $host;
}

function avp_api_is_same_origin() {
	$allowed_hosts = array();
	$home = wp_parse_url(home_url());
	$site = wp_parse_url(site_url());
	if (!empty($home['host'])) {
		$allowed_hosts[] = avp_api_normalize_host($home['host']);
	}
	if (!empty($site['host'])) {
		$allowed_hosts[] = avp_api_normalize_host($site['host']);
	}
	$allowed_hosts = array_values(array_unique(array_filter($allowed_hosts)));
	if (!$allowed_hosts) {
		return false;
	}

	$origin = isset($_SERVER['HTTP_ORIGIN']) ? (string) $_SERVER['HTTP_ORIGIN'] : '';
	if ($origin) {
		$o = wp_parse_url($origin);
		$origin_host = isset($o['host']) ? $o['host'] : '';
		return $origin_host && in_array(avp_api_normalize_host($origin_host), $allowed_hosts, true);
	}

	$referer = isset($_SERVER['HTTP_REFERER']) ? (string) $_SERVER['HTTP_REFERER'] : '';
	if ($referer) {
		$r = wp_parse_url($referer);
		$ref_host = isset($r['host']) ? $r['host'] : '';
		return $ref_host && in_array(avp_api_normalize_host($ref_host), $allowed_hosts, true);
	}

	return false;
}

function avp_api_send($status, $payload) {
	http_response_code((int) $status);
	echo wp_json_encode($payload);
	exit;
}

$op = isset($_REQUEST['op']) ? sanitize_key(wp_unslash($_REQUEST['op'])) : '';
if (!$op) {
	avp_api_send(400, array('success' => false, 'data' => array('message' => 'Missing op')));
}

// CSRF protection: require same-origin for all operations.
if (!avp_api_is_same_origin()) {
	avp_api_send(403, array('success' => false, 'data' => array('message' => 'Forbidden (origin)')));
}

// Optional plugin nonce to harden (but do not block if caches break it).
$nonce = '';
if (isset($_REQUEST['nonce'])) {
	$nonce = (string) sanitize_text_field(wp_unslash($_REQUEST['nonce']));
}
$has_valid_nonce = $nonce ? (bool) wp_verify_nonce($nonce, 'avp_gallery_nonce') : false;

// For "write" operations we require login. For reads, it's optional.
$is_logged_in = is_user_logged_in();

if ($op === 'me') {
	avp_api_send(200, array(
		'success' => true,
		'data' => array(
			'isLoggedIn' => $is_logged_in,
			'userId' => $is_logged_in ? get_current_user_id() : 0,
			'nonceOk' => $has_valid_nonce,
		),
	));
}

if ($op === 'get_rating') {
	$image_key = isset($_REQUEST['imageKey']) ? sanitize_text_field(wp_unslash($_REQUEST['imageKey'])) : '';
	if (!$image_key) {
		avp_api_send(400, array('success' => false, 'data' => array('message' => 'Missing imageKey')));
	}

	$user_id = $is_logged_in ? get_current_user_id() : 0;
	$stats = AVP_Gallery_DB::get_stats($image_key);
	$user_rating = $is_logged_in ? AVP_Gallery_DB::get_user_rating($image_key, $user_id) : null;

	avp_api_send(200, array(
		'success' => true,
		'data' => array(
			'stats' => $stats,
			'userRating' => $user_rating,
			'isLoggedIn' => $is_logged_in,
		),
	));
}

if ($op === 'set_rating') {
	if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
		avp_api_send(405, array('success' => false, 'data' => array('message' => 'Method not allowed')));
	}

	if (!$is_logged_in) {
		avp_api_send(401, array('success' => false, 'data' => array('message' => 'Unauthorized')));
	}

	// If nonce is present, enforce it. If absent, allow same-origin + logged-in.
	if ($nonce !== '' && !$has_valid_nonce) {
		avp_api_send(403, array('success' => false, 'data' => array('message' => 'Nonce invalido')));
	}

	$image_key = isset($_POST['imageKey']) ? sanitize_text_field(wp_unslash($_POST['imageKey'])) : '';
	$image_url = isset($_POST['imageUrl']) ? esc_url_raw(wp_unslash($_POST['imageUrl'])) : '';
	$rating = isset($_POST['rating']) ? intval($_POST['rating']) : null;

	if (!$image_key || !$image_url || $rating === null) {
		avp_api_send(400, array('success' => false, 'data' => array('message' => 'Missing params')));
	}

	$user_id = get_current_user_id();
	$stats = AVP_Gallery_DB::set_user_rating($image_key, $image_url, $user_id, $rating);

	avp_api_send(200, array(
		'success' => true,
		'data' => array(
			'stats' => $stats,
			'userRating' => AVP_Gallery_DB::get_user_rating($image_key, $user_id),
			'isLoggedIn' => true,
		),
	));
}

if ($op === 'list_images') {
	$folder = isset($_REQUEST['folder']) ? sanitize_text_field(wp_unslash($_REQUEST['folder'])) : 'AdiosValparaiso';
	if (!class_exists('WP_REST_Request')) {
		avp_api_send(500, array('success' => false, 'data' => array('message' => 'REST not available')));
	}
	$req = new WP_REST_Request('GET', '/avp/v1/list-images');
	$req->set_param('folder', $folder);
	$res = AVP_Gallery::rest_list_images($req);
	if ($res instanceof WP_REST_Response) {
		avp_api_send($res->get_status(), $res->get_data());
	}
	avp_api_send(200, $res);
}

avp_api_send(400, array('success' => false, 'data' => array('message' => 'Unknown op')));
