# Copyright (c) 2024, Pratul Tiwari and contributors
# License: MIT

import json
import os

import frappe


def execute():
	"""Fix dashboard charts on child tables and sync workspace layout."""
	frappe.db.sql(
		"""
		UPDATE `tabDashboard Chart`
		SET parent_document_type = 'Item Code Request'
		WHERE document_type = 'Item Code Request Item'
			AND IFNULL(parent_document_type, '') = ''
		"""
	)

	if frappe.db.exists("Dashboard Chart", "Items Created by Group"):
		frappe.db.set_value(
			"Dashboard Chart",
			"Items Created by Group",
			{
				"chart_type": "Custom",
				"source": "Items Created by Group",
				"document_type": "Item Code Request",
				"type": "Donut",
			},
		)

	# Sync workspace from fixture JSON (ensures nc7/nc8 cards + single Live Analytics shortcut)
	ws_path = os.path.join(
		frappe.get_app_path("item_generator"),
		"item_generator",
		"workspace",
		"item_generator",
		"item_generator.json",
	)
	if os.path.exists(ws_path) and frappe.db.exists("Workspace", "Item Generator"):
		with open(ws_path) as f:
			ws_data = json.load(f)
		frappe.db.set_value(
			"Workspace",
			"Item Generator",
			{
				"content": ws_data.get("content"),
				"is_hidden": 0,
				"public": 1,
				"sequence_id": ws_data.get("sequence_id", 8),
			},
			update_modified=False,
		)

	frappe.clear_cache()
