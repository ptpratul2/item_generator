# Copyright (c) 2024, Pratul Tiwari and contributors
# License: MIT

from __future__ import unicode_literals

import frappe
from frappe.utils import cint, flt


def _parse_filters(filters=None):
	if not filters:
		return {}
	if isinstance(filters, str):
		filters = frappe.parse_json(filters)
	return filters or {}


def _request_where(filters=None, alias=""):
	prefix = f"{alias}." if alias else ""
	conditions = [f"{prefix}docstatus != 2"]
	values = []

	if filters.get("company"):
		conditions.append(f"{prefix}company = %s")
		values.append(filters["company"])
	if filters.get("cost_center"):
		conditions.append(f"{prefix}cost_center = %s")
		values.append(filters["cost_center"])
	if filters.get("requested_by"):
		conditions.append(f"{prefix}requested_by = %s")
		values.append(filters["requested_by"])
	if filters.get("workflow_state"):
		conditions.append(f"{prefix}workflow_state = %s")
		values.append(filters["workflow_state"])
	if filters.get("from_date"):
		conditions.append(f"DATE({prefix}request_date) >= %s")
		values.append(filters["from_date"])
	if filters.get("to_date"):
		conditions.append(f"DATE({prefix}request_date) <= %s")
		values.append(filters["to_date"])

	return " AND ".join(conditions), values


def _child_join_where(filters=None):
	parent_where, parent_values = _request_where(filters, alias="parent")
	child_conditions = ["child.parenttype = 'Item Code Request'", parent_where]
	return " AND ".join(child_conditions), parent_values


@frappe.whitelist()
def get_dashboard_stats(filters=None):
	"""Return summary KPIs and breakdowns for the realtime analytics page."""
	filters = _parse_filters(filters)
	where, values = _request_where(filters)

	summary = frappe.db.sql(
		f"""
		SELECT
			COUNT(*) AS total_requests,
			COALESCE(SUM(total_items), 0) AS total_items_requested,
			COALESCE(SUM(items_created), 0) AS total_items_created_parent,
			COALESCE(SUM(items_with_code), 0) AS total_items_with_code,
			COUNT(DISTINCT requested_by) AS unique_requestors,
			COUNT(DISTINCT cost_center) AS unique_cost_centers,
			COUNT(DISTINCT company) AS unique_companies
		FROM `tabItem Code Request`
		WHERE {where}
		""",
		values,
		as_dict=True,
	)[0]

	child_where, child_values = _child_join_where(filters)
	child_stats = frappe.db.sql(
		f"""
		SELECT
			COUNT(*) AS total_line_items,
			SUM(CASE WHEN child.item_created = 1 THEN 1 ELSE 0 END) AS items_created,
			SUM(
				CASE
					WHEN child.is_asset_item = 1 AND child.item_created = 1
					THEN 1 ELSE 0
				END
			) AS fixed_asset_items_created,
			SUM(
				CASE
					WHEN child.is_asset_item = 1 AND TRIM(IFNULL(child.asset_code, '')) != ''
					THEN 1 ELSE 0
				END
			) AS asset_codes_entered,
			SUM(
				CASE
					WHEN IFNULL(child.generated_code, '') != '' AND child.item_created = 0
					THEN 1 ELSE 0
				END
			) AS items_pending_creation,
			SUM(
				CASE WHEN IFNULL(child.generated_code, '') = '' THEN 1 ELSE 0 END
			) AS items_without_code
		FROM `tabItem Code Request Item` child
		INNER JOIN `tabItem Code Request` parent ON child.parent = parent.name
		WHERE {child_where}
		""",
		child_values,
		as_dict=True,
	)[0]

	# Fixed assets created in ERPNext (is_fixed_asset on Item)
	erp_fixed_asset_count = frappe.db.sql(
		f"""
		SELECT COUNT(DISTINCT item.name) AS count
		FROM `tabItem` item
		INNER JOIN `tabItem Code Request Item` child ON child.generated_code = item.name
		INNER JOIN `tabItem Code Request` parent ON child.parent = parent.name
		WHERE {child_where}
			AND child.is_asset_item = 1
			AND child.item_created = 1
			AND item.is_fixed_asset = 1
		""",
		child_values,
		as_dict=True,
	)[0].count

	pending_codification = frappe.db.sql(
		f"""
		SELECT COUNT(*) AS count
		FROM `tabItem Code Request`
		WHERE {where} AND workflow_state = 'Pending Codification'
		""",
		values,
		as_dict=True,
	)[0].count

	by_status = frappe.db.sql(
		f"""
		SELECT workflow_state AS label, COUNT(*) AS value
		FROM `tabItem Code Request`
		WHERE {where}
		GROUP BY workflow_state
		ORDER BY value DESC
		""",
		values,
		as_dict=True,
	)

	by_requested_by = frappe.db.sql(
		f"""
		SELECT
			requested_by AS label,
			COUNT(*) AS requests,
			COALESCE(SUM(total_items), 0) AS items_requested,
			COALESCE(SUM(items_created), 0) AS items_created
		FROM `tabItem Code Request`
		WHERE {where} AND IFNULL(requested_by, '') != ''
		GROUP BY requested_by
		ORDER BY items_requested DESC
		LIMIT 20
		""",
		values,
		as_dict=True,
	)

	by_cost_center = frappe.db.sql(
		f"""
		SELECT
			cost_center AS label,
			COUNT(*) AS requests,
			COALESCE(SUM(total_items), 0) AS items_requested,
			COALESCE(SUM(items_created), 0) AS items_created
		FROM `tabItem Code Request`
		WHERE {where} AND IFNULL(cost_center, '') != ''
		GROUP BY cost_center
		ORDER BY items_requested DESC
		LIMIT 20
		""",
		values,
		as_dict=True,
	)

	by_company = frappe.db.sql(
		f"""
		SELECT
			company AS label,
			COUNT(*) AS requests,
			COALESCE(SUM(total_items), 0) AS items_requested,
			COALESCE(SUM(items_created), 0) AS items_created
		FROM `tabItem Code Request`
		WHERE {where} AND IFNULL(company, '') != ''
		GROUP BY company
		ORDER BY items_requested DESC
		LIMIT 20
		""",
		values,
		as_dict=True,
	)

	by_item_group = frappe.db.sql(
		f"""
		SELECT
			child.item_group AS label,
			COUNT(*) AS value
		FROM `tabItem Code Request Item` child
		INNER JOIN `tabItem Code Request` parent ON child.parent = parent.name
		WHERE {child_where} AND child.item_created = 1 AND IFNULL(child.item_group, '') != ''
		GROUP BY child.item_group
		ORDER BY value DESC
		LIMIT 15
		""",
		child_values,
		as_dict=True,
	)

	timeline = frappe.db.sql(
		f"""
		SELECT DATE(creation) AS date, COUNT(*) AS requests
		FROM `tabItem Code Request`
		WHERE {where}
		GROUP BY DATE(creation)
		ORDER BY date ASC
		LIMIT 90
		""",
		values,
		as_dict=True,
	)

	fixed_asset_items_timeline = frappe.db.sql(
		f"""
		SELECT DATE(child.modified) AS date, COUNT(*) AS value
		FROM `tabItem Code Request Item` child
		INNER JOIN `tabItem Code Request` parent ON child.parent = parent.name
		WHERE {child_where}
			AND child.is_asset_item = 1
			AND child.item_created = 1
		GROUP BY DATE(child.modified)
		ORDER BY date ASC
		LIMIT 90
		""",
		child_values,
		as_dict=True,
	)

	asset_codes_timeline = frappe.db.sql(
		f"""
		SELECT DATE(child.modified) AS date, COUNT(*) AS value
		FROM `tabItem Code Request Item` child
		INNER JOIN `tabItem Code Request` parent ON child.parent = parent.name
		WHERE {child_where}
			AND child.is_asset_item = 1
			AND TRIM(IFNULL(child.asset_code, '')) != ''
		GROUP BY DATE(child.modified)
		ORDER BY date ASC
		LIMIT 90
		""",
		child_values,
		as_dict=True,
	)

	fixed_asset_by_category = frappe.db.sql(
		f"""
		SELECT
			IFNULL(NULLIF(child.asset_category, ''), 'Not Set') AS label,
			COUNT(*) AS value
		FROM `tabItem Code Request Item` child
		INNER JOIN `tabItem Code Request` parent ON child.parent = parent.name
		WHERE {child_where}
			AND child.is_asset_item = 1
			AND child.item_created = 1
		GROUP BY child.asset_category
		ORDER BY value DESC
		LIMIT 15
		""",
		child_values,
		as_dict=True,
	)

	asset_codes_by_cost_center = frappe.db.sql(
		f"""
		SELECT
			parent.cost_center AS label,
			COUNT(*) AS value
		FROM `tabItem Code Request Item` child
		INNER JOIN `tabItem Code Request` parent ON child.parent = parent.name
		WHERE {child_where}
			AND child.is_asset_item = 1
			AND TRIM(IFNULL(child.asset_code, '')) != ''
			AND IFNULL(parent.cost_center, '') != ''
		GROUP BY parent.cost_center
		ORDER BY value DESC
		LIMIT 15
		""",
		child_values,
		as_dict=True,
	)

	return {
		"summary": {
			"total_requests": cint(summary.total_requests),
			"total_items_requested": cint(summary.total_items_requested),
			"total_items_created": cint(child_stats.items_created),
			"total_items_with_code": cint(summary.total_items_with_code),
			"items_pending_creation": cint(child_stats.items_pending_creation),
			"items_without_code": cint(child_stats.items_without_code),
			"unique_requestors": cint(summary.unique_requestors),
			"unique_cost_centers": cint(summary.unique_cost_centers),
			"unique_companies": cint(summary.unique_companies),
			"pending_codification": cint(pending_codification),
			"fixed_asset_items_created": cint(erp_fixed_asset_count or child_stats.fixed_asset_items_created),
			"asset_codes_entered": cint(child_stats.asset_codes_entered),
		},
		"by_status": by_status,
		"by_requested_by": by_requested_by,
		"by_cost_center": by_cost_center,
		"by_company": by_company,
		"by_item_group": by_item_group,
		"fixed_asset_items_timeline": fixed_asset_items_timeline,
		"asset_codes_timeline": asset_codes_timeline,
		"fixed_asset_by_category": fixed_asset_by_category,
		"asset_codes_by_cost_center": asset_codes_by_cost_center,
		"timeline": timeline,
		"filters": filters,
		"refreshed_at": frappe.utils.now_datetime(),
	}


# --- Number Card methods (Custom type) ---


def _number_from_filters(filters=None, field="total_items_requested"):
	stats = get_dashboard_stats(filters)
	return flt(stats["summary"].get(field, 0))


@frappe.whitelist()
def get_number_total_items_requested(filters=None):
	return _number_from_filters(filters, "total_items_requested")


@frappe.whitelist()
def get_number_total_items_created(filters=None):
	return _number_from_filters(filters, "total_items_created")


@frappe.whitelist()
def get_number_total_requests(filters=None):
	return _number_from_filters(filters, "total_requests")


@frappe.whitelist()
def get_number_unique_requestors(filters=None):
	return _number_from_filters(filters, "unique_requestors")


@frappe.whitelist()
def get_number_pending_codification(filters=None):
	return _number_from_filters(filters, "pending_codification")


@frappe.whitelist()
def get_number_items_pending_creation(filters=None):
	return _number_from_filters(filters, "items_pending_creation")


@frappe.whitelist()
def get_number_fixed_asset_items_created(filters=None):
	return _number_from_filters(filters, "fixed_asset_items_created")


@frappe.whitelist()
def get_number_asset_codes_entered(filters=None):
	return _number_from_filters(filters, "asset_codes_entered")


@frappe.whitelist()
def has_app_permission():
	"""Show Item Generator on the apps screen for users who can access requests."""
	return frappe.has_permission("Item Code Request", "read")
