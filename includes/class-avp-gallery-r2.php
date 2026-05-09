<?php

if (!defined('ABSPATH')) {
	exit;
}

class AVP_Gallery_R2 {
	private static function get_endpoint_host($settings) {
		if (!empty($settings['endpoint'])) {
			$host = wp_parse_url($settings['endpoint'], PHP_URL_HOST);
			if ($host) {
				return $host;
			}
		}
		if (empty($settings['account_id'])) {
			return '';
		}
		return $settings['account_id'] . '.r2.cloudflarestorage.com';
	}

	private static function get_endpoint_url($settings) {
		if (!empty($settings['endpoint'])) {
			$endpoint = rtrim($settings['endpoint'], '/');
			if (strpos($endpoint, 'http://') === 0 || strpos($endpoint, 'https://') === 0) {
				return $endpoint;
			}
			return 'https://' . $endpoint;
		}
		$host = self::get_endpoint_host($settings);
		return $host ? 'https://' . $host : '';
	}

	private static function hmac_sha256($key, $msg, $raw = true) {
		return hash_hmac('sha256', $msg, $key, $raw);
	}

	private static function sha256_hex($msg) {
		return hash('sha256', $msg);
	}

	private static function aws_encode($str, $encode_slash = true) {
		$enc = rawurlencode($str);
		if (!$encode_slash) {
			$enc = str_replace('%2F', '/', $enc);
		}
		return $enc;
	}

	private static function derive_signing_key($secret, $date, $region, $service) {
		$k_date = self::hmac_sha256('AWS4' . $secret, $date);
		$k_region = self::hmac_sha256($k_date, $region);
		$k_service = self::hmac_sha256($k_region, $service);
		return self::hmac_sha256($k_service, 'aws4_request');
	}

	public static function list_images($settings, $prefix = '', $max_keys = 1000) {
		$endpoint = self::get_endpoint_url($settings);
		$host = self::get_endpoint_host($settings);
		$bucket = isset($settings['bucket']) ? $settings['bucket'] : '';
		$access_key = isset($settings['access_key_id']) ? $settings['access_key_id'] : '';
		$secret = isset($settings['secret_access_key']) ? $settings['secret_access_key'] : '';

		if (!$endpoint || !$host || !$bucket || !$access_key || !$secret) {
			return new WP_Error('avp_r2_missing', 'R2 settings incompletos');
		}

		$region = 'auto';
		$service = 's3';

		$prefix = trim((string) $prefix);
		$prefix = ltrim($prefix, '/');

		$continuation = null;
		$objects = array();

		do {
			$query = array(
				'list-type' => '2',
				'max-keys' => (string) min(1000, max(1, intval($max_keys))),
			);
			if ($prefix !== '') {
				$query['prefix'] = $prefix;
			}
			if ($continuation) {
				$query['continuation-token'] = $continuation;
			}

			$amz_date = gmdate('Ymd\THis\Z');
			$date_stamp = gmdate('Ymd');

			$canonical_uri = '/' . self::aws_encode($bucket, false);

			ksort($query);
			$canonical_query = array();
			foreach ($query as $k => $v) {
				$canonical_query[] = self::aws_encode($k) . '=' . self::aws_encode($v);
			}
			$canonical_query = implode('&', $canonical_query);

			$canonical_headers = 'host:' . $host . "\n" . 'x-amz-date:' . $amz_date . "\n";
			$signed_headers = 'host;x-amz-date';
			$payload_hash = 'UNSIGNED-PAYLOAD';

			$canonical_request = "GET\n{$canonical_uri}\n{$canonical_query}\n{$canonical_headers}\n{$signed_headers}\n{$payload_hash}";

			$credential_scope = $date_stamp . '/' . $region . '/' . $service . '/aws4_request';
			$string_to_sign = "AWS4-HMAC-SHA256\n{$amz_date}\n{$credential_scope}\n" . self::sha256_hex($canonical_request);
			$signing_key = self::derive_signing_key($secret, $date_stamp, $region, $service);
			$signature = hash_hmac('sha256', $string_to_sign, $signing_key);

			$authorization = 'AWS4-HMAC-SHA256 ' .
				'Credential=' . $access_key . '/' . $credential_scope . ', ' .
				'SignedHeaders=' . $signed_headers . ', ' .
				'Signature=' . $signature;

			$url = $endpoint . $canonical_uri . '?' . $canonical_query;

			$response = wp_remote_get($url, array(
				'timeout' => 20,
				'headers' => array(
					'Authorization' => $authorization,
					'x-amz-date' => $amz_date,
					'x-amz-content-sha256' => $payload_hash,
				),
			));

			if (is_wp_error($response)) {
				return $response;
			}
			$code = wp_remote_retrieve_response_code($response);
			$body = wp_remote_retrieve_body($response);
			if ($code < 200 || $code >= 300) {
				return new WP_Error('avp_r2_http', 'Error listando objetos en R2', array('status' => $code, 'body' => $body));
			}

			$xml = @simplexml_load_string($body);
			if (!$xml) {
				return new WP_Error('avp_r2_xml', 'Respuesta XML inválida desde R2');
			}

			if (isset($xml->Contents)) {
				foreach ($xml->Contents as $c) {
					$key = (string) $c->Key;
					if (!$key) {
						continue;
					}
					$objects[] = $key;
				}
			}

			$is_truncated = ((string) $xml->IsTruncated) === 'true';
			$continuation = $is_truncated ? (string) $xml->NextContinuationToken : null;
		} while ($continuation);

		return $objects;
	}

	public static function object_url($settings, $key) {
		$key = ltrim((string) $key, '/');
		$bucket = isset($settings['bucket']) ? $settings['bucket'] : '';

		if (empty($settings['public_base_url'])) {
			$endpoint = self::get_endpoint_url($settings);
			if (!$endpoint || !$bucket) {
				return '';
			}
			return $endpoint . '/' . rawurlencode($bucket) . '/' . str_replace('%2F', '/', rawurlencode($key));
		}

		$base = rtrim($settings['public_base_url'], '/');
		return $base . '/' . str_replace('%2F', '/', rawurlencode($key));
	}

	public static function presign_get($settings, $key, $expires) {
		$endpoint = self::get_endpoint_url($settings);
		$host = self::get_endpoint_host($settings);
		$bucket = isset($settings['bucket']) ? $settings['bucket'] : '';
		$access_key = isset($settings['access_key_id']) ? $settings['access_key_id'] : '';
		$secret = isset($settings['secret_access_key']) ? $settings['secret_access_key'] : '';

		if (!$endpoint || !$host || !$bucket || !$access_key || !$secret) {
			return '';
		}

		$region = 'auto';
		$service = 's3';

		$amz_date = gmdate('Ymd\THis\Z');
		$date_stamp = gmdate('Ymd');
		$expires = intval($expires);
		if ($expires < 60) {
			$expires = 60;
		}
		if ($expires > 604800) {
			$expires = 604800;
		}

		$canonical_uri = '/' . self::aws_encode($bucket, false) . '/' . self::aws_encode($key, false);

		$credential_scope = $date_stamp . '/' . $region . '/' . $service . '/aws4_request';

		$query = array(
			'X-Amz-Algorithm' => 'AWS4-HMAC-SHA256',
			'X-Amz-Credential' => $access_key . '/' . $credential_scope,
			'X-Amz-Date' => $amz_date,
			'X-Amz-Expires' => (string) $expires,
			'X-Amz-SignedHeaders' => 'host',
		);
		ksort($query);
		$canonical_query = array();
		foreach ($query as $k => $v) {
			$canonical_query[] = self::aws_encode($k) . '=' . self::aws_encode($v);
		}
		$canonical_query = implode('&', $canonical_query);

		$canonical_headers = 'host:' . $host . "\n";
		$signed_headers = 'host';
		$payload_hash = 'UNSIGNED-PAYLOAD';

		$canonical_request = "GET\n{$canonical_uri}\n{$canonical_query}\n{$canonical_headers}\n{$signed_headers}\n{$payload_hash}";
		$string_to_sign = "AWS4-HMAC-SHA256\n{$amz_date}\n{$credential_scope}\n" . self::sha256_hex($canonical_request);
		$signing_key = self::derive_signing_key($secret, $date_stamp, $region, $service);
		$signature = hash_hmac('sha256', $string_to_sign, $signing_key);

		return $endpoint . $canonical_uri . '?' . $canonical_query . '&X-Amz-Signature=' . $signature;
	}
}

