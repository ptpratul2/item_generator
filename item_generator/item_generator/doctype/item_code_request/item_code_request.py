# -*- coding: utf-8 -*-
# Copyright (c) 2024, Pratul Tiwari and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe
from frappe.model.document import Document
from frappe.utils import cint

class ItemCodeRequest(Document):
	def before_insert(self):
		"""Auto-fill fields before insert"""
		self.auto_fill_fields()
		# Ensure default values for child table
		for item in self.items:
			item.item_created = 0

	def validate(self):
		"""Validate Item Code Request"""
		# Auto-fill fields if empty
		self.auto_fill_fields()
		
		# Validate each item in the child table
		for item in self.items:
			if cint(item.is_asset_item) and not item.asset_category:
				frappe.throw(f"Asset Category is required for item '{item.item_name}' when Is Asset Item is checked")
			
			# Validate expense account is filled before moving to Approved state
			if self.workflow_state == "Pending Account Verification" and not item.expense_account:
				frappe.throw(f"Expense Account is required for item '{item.item_name}' before approval")
			
			# Validate UOM is filled
			if not item.uom:
				frappe.throw(f"UOM (Unit of Measure) is required for item '{item.item_name}'")
		
		# Validate Cost Center belongs to Company
		if self.cost_center and self.company:
			cc_company = frappe.get_value("Cost Center", self.cost_center, "company")
			if cc_company != self.company:
				frappe.throw(f"Cost Center '{self.cost_center}' does not belong to Company '{self.company}'")
		
		# Update summary counts
		self.update_summary_counts()
	
	def auto_fill_fields(self):
		"""Auto-fill request details if empty"""
		# Auto-fill Requested By with current user
		if not self.requested_by:
			self.requested_by = frappe.session.user
		
		# Auto-fill Request Date with current datetime
		if not self.request_date:
			self.request_date = frappe.utils.now_datetime()

		# Auto-fill Company from Cost Center
		if not self.company and self.cost_center:
			self.company = frappe.get_value("Cost Center", self.cost_center, "company")
	
	def update_summary_counts(self):
		"""Update summary counts"""
		self.total_items = len(self.items)
		self.items_with_code = sum(1 for item in self.items if item.generated_code)
		self.items_created = sum(1 for item in self.items if item.item_created)
	
	def on_submit(self):
		"""On submit - create items if workflow state is Approved"""
		if self.workflow_state == "Approved":
			self.create_all_items()
	
	def on_update_after_submit(self):
		"""On update after submit - create items when workflow state changes to Approved"""
		if self.workflow_state == "Approved" and not self.all_items_created():
			self.create_all_items()
		
		# Update summary counts
		self.update_summary_counts()
		self.db_set('total_items', self.total_items, update_modified=False)
		self.db_set('items_with_code', self.items_with_code, update_modified=False)
		self.db_set('items_created', self.items_created, update_modified=False)
	
	def all_items_created(self):
		"""Check if all items with generated codes have been created"""
		for item in self.items:
			if item.generated_code and not item.item_created:
				if not frappe.db.exists("Item", item.generated_code):
					return False
		return True
	
	def create_all_items(self):
		"""Create all items that have generated codes"""
		items_created = []
		items_failed = []
		
		for item_row in self.items:
			if not item_row.generated_code:
				continue
			
			if item_row.item_created:
				continue
			
			if frappe.db.exists("Item", item_row.generated_code):
				item_row.item_created = 1
				item_row.db_update()
				continue
			
			try:
				self.create_single_item(item_row)
				items_created.append(item_row.generated_code)
			except Exception as e:
				items_failed.append({
					'name': item_row.item_name,
					'code': item_row.generated_code,
					'error': str(e)
				})
				frappe.log_error(
					title="Item Creation Error",
					message=f"Error creating Item {item_row.generated_code} from {self.name}: {str(e)}"
				)
		
		# Update summary counts
		self.update_summary_counts()
		self.db_set('total_items', self.total_items, update_modified=False)
		self.db_set('items_with_code', self.items_with_code, update_modified=False)
		self.db_set('items_created', self.items_created, update_modified=False)
		
		# Add comment about created items
		if items_created:
			self.add_comment(
				"Info",
				f"Created {len(items_created)} items in ERPNext: {', '.join(items_created)}"
			)
			frappe.msgprint(
				f"Successfully created {len(items_created)} items in ERPNext.",
				alert=True,
				indicator="green"
			)
		
		if items_failed:
			error_msg = "<br>".join([
				f"• {item['name']} ({item['code']}): {item['error']}"
				for item in items_failed
			])
			frappe.msgprint(
				f"<b>Failed to create {len(items_failed)} items:</b><br>{error_msg}",
				title="Item Creation Errors",
				indicator="red"
			)
	
	def create_single_item(self, item_row):
		"""Create a single item in ERPNext"""
		if not item_row.generated_code:
			frappe.throw(f"Generated Code is required to create Item for '{item_row.item_name}'")
		
		if not item_row.expense_account:
			frappe.throw(f"Expense Account is required to create Item for '{item_row.item_name}'")
		
		if not item_row.uom:
			frappe.throw(f"UOM is required to create Item for '{item_row.item_name}'")
		
		if frappe.db.exists("Item", item_row.generated_code):
			frappe.msgprint(f"Item {item_row.generated_code} already exists in ERPNext.")
			item_row.item_created = 1
			item_row.db_update()
			return
		
		# Create new Item
		item = frappe.get_doc({
			"doctype": "Item",
			"item_code": item_row.generated_code,
			"item_name": item_row.item_name,
			"item_group": item_row.item_group,
			"description": item_row.description or item_row.item_name,
			"stock_uom": item_row.uom,
			"gst_hsn_code": item_row.hsn_code,
			"is_stock_item": item_row.is_stock_item,
			"is_fixed_asset": item_row.is_asset_item,
			"asset_category": item_row.asset_category if item_row.is_asset_item else None,
			"disabled": 0
		})
		
		# Add default accounts (expense account)
		item.append("item_defaults", {
			"company": self.company or frappe.defaults.get_defaults().get("company"),
			"expense_account": item_row.expense_account,
			"default_warehouse": ""  # Prevent invalid global defaults from Item Group
		})
		
		item.insert(ignore_permissions=True)
		
		# Mark as created
		item_row.item_created = 1
		item_row.db_update()
		
		return item


def on_submit_hook(doc, method):
	"""Hook called on submit"""
	doc.on_submit()


def on_update_after_submit_hook(doc, method):
	"""Hook called on update after submit"""
	doc.on_update_after_submit()


@frappe.whitelist()
def get_total_items_requested():
	"""Get total count of all items requested across all requests"""
	result = frappe.db.sql("""
		SELECT SUM(total_items) as total
		FROM `tabItem Code Request`
		WHERE docstatus != 2
	""", as_dict=True)
	
	return result[0].total if result and result[0].total else 0


@frappe.whitelist()
def get_total_items_created():
	"""Get total count of all items created in ERPNext"""
	result = frappe.db.sql("""
		SELECT SUM(items_created) as total
		FROM `tabItem Code Request`
		WHERE workflow_state = 'Approved' AND docstatus = 1
	""", as_dict=True)
	
	return result[0].total if result and result[0].total else 0
