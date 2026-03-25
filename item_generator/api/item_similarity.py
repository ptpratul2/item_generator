


# Copyright (c) 2024, Pratul Tiwari and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe


def _normalize_query(query: str) -> str:
	"""Normalize search input"""
	if not query or not isinstance(query, str):
		return ""
	return " ".join(query.lower().strip().split())


@frappe.whitelist()
def get_similar_items(query: str) -> list:
	"""Main API"""
	query = _normalize_query(query)

	if len(query) < 3:
		return []

	return _search_with_like(query)


def _search_with_like(query: str) -> list:

	words = query.split()

	conditions = []
	values = []

	for word in words:
		escaped = word.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
		pattern = f"%{escaped}%"

		conditions.append("(item_name LIKE %s OR description LIKE %s OR item_code LIKE %s)")
		values.extend([pattern, pattern, pattern])

	where_clause = " AND ".join(conditions)

	query_sql = f"""
		SELECT name, item_code, item_name, description
		FROM tabItem
		WHERE {where_clause}
	"""

	results = frappe.db.sql(query_sql, tuple(values), as_dict=True)

	return _apply_fuzzy_ranking(query, results)


def _apply_fuzzy_ranking(query: str, results: list) -> list:
	"""
	Fuzzy ranking using rapidfuzz
	"""
	try:
		from rapidfuzz import fuzz, utils
	except ImportError:
		# fallback (no error)
		return [{
			"name": r.get("name"),
			"item_code": r.get("item_code"),
			"item_name": r.get("item_name"),
			"score": 0
		} for r in results[:5]]

	processor = utils.default_process
	scored = []

	for r in results:
		item_name = (r.get("item_name") or "").strip()
		description = (r.get("description") or "").strip()
		item_code = (r.get("item_code") or "").strip()

		text = f"{item_name} {description}".strip()

		# Name score
		name_score = max(
			fuzz.ratio(query, item_name, processor=processor),
			fuzz.partial_ratio(query, item_name, processor=processor),
			fuzz.token_sort_ratio(query, item_name, processor=processor),
		)

		# Full text score
		text_score = max(
			fuzz.partial_ratio(query, text, processor=processor),
			fuzz.token_sort_ratio(query, text, processor=processor),
		)

		# Code score
		code_score = fuzz.partial_ratio(query, item_code, processor=processor)

		combined_score = max(name_score, text_score, code_score)

		scored.append({
			"name": r.get("name"),
			"item_code": item_code,
			"item_name": item_name,
			"score": combined_score,
		})

	# Sort by best match
	scored.sort(key=lambda x: x["score"], reverse=True)

	return scored[:5]