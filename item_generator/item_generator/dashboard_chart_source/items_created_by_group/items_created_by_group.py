# Copyright (c) 2024, Pratul Tiwari and contributors
# License: MIT

from __future__ import unicode_literals

import frappe
from frappe.utils.dashboard import cache_source

from item_generator.api.dashboard import _child_join_where, _parse_filters


@frappe.whitelist()
@cache_source
def get_data(
	chart_name=None,
	chart=None,
	no_cache=None,
	filters=None,
	from_date=None,
	to_date=None,
	timespan=None,
	time_interval=None,
	heatmap_year=None,
):
	filters = _parse_filters(filters)
	child_where, child_values = _child_join_where(filters)

	data = frappe.db.sql(
		f"""
		SELECT
			IFNULL(NULLIF(child.item_group, ''), 'Not Set') AS name,
			COUNT(*) AS count
		FROM `tabItem Code Request Item` child
		INNER JOIN `tabItem Code Request` parent ON child.parent = parent.name
		WHERE {child_where}
			AND child.item_created = 1
		GROUP BY child.item_group
		ORDER BY count DESC
		LIMIT 20
		""",
		child_values,
		as_dict=True,
	)

	if not data:
		return None

	return {
		"labels": [row.name for row in data],
		"datasets": [
			{"name": chart_name or "Items Created by Group", "values": [row.count for row in data]}
		],
	}
