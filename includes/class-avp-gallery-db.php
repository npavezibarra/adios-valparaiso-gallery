<?php

if (!defined('ABSPATH')) {
	exit;
}

class AVP_Gallery_DB {
	public static function table_name() {
		global $wpdb;
		return $wpdb->prefix . 'avp_image_ratings';
	}

	/**
	 * Returns aggregated stats (votes + avg) for many image keys.
	 *
	 * @param string[] $image_keys
	 * @return array<string, array{votes:int, avg:float}>
	 */
	public static function get_stats_map($image_keys) {
		global $wpdb;
		$table = self::table_name();

		if (!is_array($image_keys) || empty($image_keys)) {
			return array();
		}

		$image_keys = array_values(array_unique(array_filter(array_map(function ($k) {
			return sanitize_text_field((string) $k);
		}, $image_keys))));

		if (empty($image_keys)) {
			return array();
		}

		$placeholders = implode(',', array_fill(0, count($image_keys), '%s'));
		$sql = "SELECT image_key, COUNT(*) AS votes, AVG(rating) AS avg_rating
			FROM {$table}
			WHERE image_key IN ({$placeholders})
			GROUP BY image_key";

		$rows = $wpdb->get_results($wpdb->prepare($sql, $image_keys), ARRAY_A);

		$map = array();
		foreach ((array) $rows as $row) {
			$key = isset($row['image_key']) ? (string) $row['image_key'] : '';
			if ($key === '') {
				continue;
			}
			$map[$key] = array(
				'votes' => isset($row['votes']) ? intval($row['votes']) : 0,
				'avg' => isset($row['avg_rating']) && $row['avg_rating'] !== null ? floatval($row['avg_rating']) : 0.0,
			);
		}

		return $map;
	}

	public static function activate() {
		global $wpdb;

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$charset_collate = $wpdb->get_charset_collate();
		$table = self::table_name();

		$sql = "CREATE TABLE {$table} (
			id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
			image_key VARCHAR(64) NOT NULL,
			image_path TEXT NOT NULL,
			user_id BIGINT(20) UNSIGNED NOT NULL,
			rating TINYINT(1) UNSIGNED NOT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY  (id),
			UNIQUE KEY image_user (image_key, user_id),
			KEY image_key (image_key),
			KEY user_id (user_id)
		) {$charset_collate};";

		dbDelta($sql);
	}

	public static function sanitize_rating($rating) {
		$rating = intval($rating);
		if ($rating < 0) {
			return 0;
		}
		if ($rating > 5) {
			return 5;
		}
		return $rating;
	}

	public static function get_stats($image_key) {
		global $wpdb;
		$table = self::table_name();

		$row = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT COUNT(*) AS votes, AVG(rating) AS avg_rating FROM {$table} WHERE image_key = %s",
				$image_key
			),
			ARRAY_A
		);

		return array(
			'votes' => isset($row['votes']) ? intval($row['votes']) : 0,
			'avg' => isset($row['avg_rating']) && $row['avg_rating'] !== null ? floatval($row['avg_rating']) : 0.0,
		);
	}

	public static function get_user_rating($image_key, $user_id) {
		global $wpdb;
		$table = self::table_name();

		$rating = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT rating FROM {$table} WHERE image_key = %s AND user_id = %d",
				$image_key,
				$user_id
			)
		);

		if ($rating === null) {
			return null;
		}

		return intval($rating);
	}

	public static function set_user_rating($image_key, $image_path, $user_id, $rating) {
		global $wpdb;
		$table = self::table_name();

		$rating = self::sanitize_rating($rating);

		$wpdb->query(
			$wpdb->prepare(
				"INSERT INTO {$table} (image_key, image_path, user_id, rating)
				VALUES (%s, %s, %d, %d)
				ON DUPLICATE KEY UPDATE rating = VALUES(rating), image_path = VALUES(image_path)",
				$image_key,
				$image_path,
				$user_id,
				$rating
			)
		);

		return self::get_stats($image_key);
	}
}
