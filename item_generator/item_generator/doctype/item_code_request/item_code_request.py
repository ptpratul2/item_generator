# -*- coding: utf-8 -*-
# Copyright (c) 2024, Pratul Tiwari and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe
from frappe.model.document import Document
from frappe.utils import cint, validate_email_address

class ItemCodeRequest(Document):
	def before_insert(self):
		"""Auto-fill fields before insert"""
		self.auto_fill_fields()
		# Ensure default values for child table
		for item in self.items:
			item.item_created = 0

	def validate(self):
		"""Validate Item Code Request"""
		previous_state = (
			self._doc_before_save.get("workflow_state")
			if getattr(self, "_doc_before_save", None)
			else None
		)
		is_review_to_draft = (
			previous_state
			and previous_state != "Draft"
			and self.workflow_state == "Draft"
		)
		is_send_to_ecode = (
			previous_state == "Pending Account Verification"
			and self.workflow_state == "Pending Codification"
		)
		is_discard_transition = (
			previous_state
			and previous_state != "Discard"
			and self.workflow_state == "Discard"
		)
		should_skip_mandatory_validations = (
			is_review_to_draft
			or is_send_to_ecode
			or is_discard_transition
		)

		# Auto-fill fields if empty
		self.auto_fill_fields()
		self._validate_and_normalize_requested_by()

		# Similar item / duplicate validation
		self._validate_no_duplicate_items()
		if not should_skip_mandatory_validations:
			self._validate_generated_codes()

		# Expense account is required only when approving from Account Verification,
		# not when entering that state (e.g. Verify HSN → Pending Account Verification).
		approving_from_account_verification = (
			previous_state == "Pending Account Verification"
			and self.workflow_state == "Approved"
		)
		advancing_from_codification = (
			previous_state == "Pending Codification"
			and self.workflow_state == "Pending HSN Verification"
		)

		# Validate each item in the child table
		for item in self.items:
			if should_skip_mandatory_validations:
				continue

			if advancing_from_codification and not item.generated_code:
				frappe.throw(
					frappe._(
						"Generated Code is required for item '{0}' before sending to HSN verification"
					).format(item.item_name)
				)

			if (
				advancing_from_codification
				and cint(item.is_asset_item)
				and not (item.asset_code or "").strip()
			):
				frappe.throw(
					frappe._(
						"Asset Code is required for item '{0}' before sending to Account verification"
					).format(item.item_name)
				)

			if cint(item.is_asset_item) and not item.asset_category:
				frappe.throw(f"Asset Category is required for item '{item.item_name}' when Is Asset Item is checked")
			
			if (
				approving_from_account_verification
				and not cint(item.is_asset_item)
				and not item.expense_account
			):
				frappe.throw(
					f"Expense Account is required for item '{item.item_name}' before approval"
				)
			
			if not item.uom:
				frappe.throw(f"UOM (Unit of Measure) is required for item '{item.item_name}'")
		
		# Validate Cost Center belongs to Company
		if self.cost_center and self.company:
			cc_company = frappe.get_value("Cost Center", self.cost_center, "company")
			if cc_company != self.company:
				frappe.throw(f"Cost Center '{self.cost_center}' does not belong to Company '{self.company}'")
		
		# Update summary counts
		self.update_summary_counts()
	
	def _validate_no_duplicate_items(self):
		"""Prevent duplicate item creation - exact item_name match in existing Items."""
		for item in self.items:
			if not item.item_name or not item.item_name.strip():
				continue
			item_name = item.item_name.strip()
			# Check if exact item_name exists (case-insensitive)
			exact_match = frappe.db.sql(
				"SELECT name, item_code FROM tabItem WHERE LOWER(TRIM(item_name)) = LOWER(%s) LIMIT 1",
				(item_name,),
				as_dict=True,
			)
			if exact_match:
				frappe.throw(
					frappe._("Item with name '{0}' already exists as {1}. Please use the existing item or choose a different name.").format(
						item_name, exact_match[0].item_code
					)
				)

	def _normalize_text_for_compare(self, value):
		"""Normalize user-entered text for stable comparisons."""
		text = (value or "").replace("&amp;", "&")
		return " ".join(text.split()).strip()

	def _find_other_request_using_code(self, generated_code):
		"""Find the latest request (other than current) using the same generated code."""
		rows = frappe.db.sql(
			"""
			SELECT parent, idx, item_name
			FROM `tabItem Code Request Item`
			WHERE generated_code = %s
			  AND parent != %s
			ORDER BY modified DESC
			LIMIT 1
			""",
			(generated_code, self.name or ""),
			as_dict=True,
		)
		return rows[0] if rows else None

	def _validate_generated_code_mapping(self, item_row):
		"""Ensure generated code maps to the same item details and is not reused."""
		generated_code = (item_row.generated_code or "").strip()
		if not generated_code:
			return

		existing_item = frappe.db.get_value(
			"Item",
			generated_code,
			["name", "item_name", "description"],
			as_dict=True,
		)
		if not existing_item:
			return

		source_row = self._find_other_request_using_code(generated_code)
		if source_row:
			frappe.throw(
				frappe._(
					"Generated Code '{0}' is already used in request {1} (row {2}, item '{3}'). "
					"Please enter a unique Generated Code."
				).format(
					generated_code,
					source_row.parent,
					source_row.idx,
					source_row.item_name or "",
				)
			)

		expected_name = self._normalize_text_for_compare(item_row.item_name)
		expected_description = self._normalize_text_for_compare(
			item_row.description or item_row.item_name
		)
		existing_name = self._normalize_text_for_compare(existing_item.item_name)
		existing_description = self._normalize_text_for_compare(existing_item.description)

		if expected_name != existing_name or expected_description != existing_description:
			frappe.throw(
				frappe._(
					"Generated Code '{0}' already exists with different details. "
					"Existing Item Name: '{1}', Description: '{2}'. "
					"Current Request Item Name: '{3}', Description: '{4}'."
				).format(
					generated_code,
					existing_item.item_name or "",
					existing_item.description or "",
					item_row.item_name or "",
					item_row.description or item_row.item_name or "",
				)
			)

	def _validate_generated_codes(self):
		"""Validate generated code uniqueness within request and mapping with Item."""
		seen_codes = {}
		for item in self.items:
			generated_code = (item.generated_code or "").strip()
			if not generated_code:
				continue

			if generated_code in seen_codes:
				first_item = seen_codes[generated_code]
				frappe.throw(
					frappe._(
						"Generated Code '{0}' is duplicated in this request for '{1}' and '{2}'. "
						"Generated Code must be unique per row."
					).format(
						generated_code,
						first_item.item_name or "",
						item.item_name or "",
					)
				)

			seen_codes[generated_code] = item
			self._validate_generated_code_mapping(item)

	def _validate_and_normalize_requested_by(self):
		"""Ensure requested_by is a valid User (email / login ID), not a display name."""
		if not self.requested_by:
			self.requested_by = frappe.session.user
			return

		value = (self.requested_by or "").strip()
		if not value:
			self.requested_by = frappe.session.user
			return

		if frappe.db.exists("User", value):
			self.requested_by = value
			return

		user_row = frappe.db.sql(
			"SELECT name FROM `tabUser` WHERE LOWER(name) = LOWER(%s) LIMIT 1",
			(value,),
			as_dict=True,
		)
		if user_row:
			self.requested_by = user_row[0].name
			return

		if "@" in value:
			email = validate_email_address(value, throw=False)
			if email:
				user = frappe.db.get_value("User", email, "name") or frappe.db.get_value(
					"User", {"email": email}, "name"
				)
				if user:
					self.requested_by = user
					return

		frappe.throw(
			frappe._(
				"Requested By must be your registered email address (login ID). "
				"'{0}' is not a valid user. Please select your email from the dropdown — "
				"do not enter your display name."
			).format(value)
		)

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
				self._validate_generated_code_mapping(item_row)
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
		
		if not cint(item_row.is_asset_item) and not item_row.expense_account:
			frappe.throw(f"Expense Account is required to create Item for '{item_row.item_name}'")
		
		if not item_row.uom:
			frappe.throw(f"UOM is required to create Item for '{item_row.item_name}'")
		
		if frappe.db.exists("Item", item_row.generated_code):
			self._validate_generated_code_mapping(item_row)
			frappe.msgprint(f"Item {item_row.generated_code} already exists in ERPNext.")
			item_row.item_created = 1
			item_row.db_update()
			return
		
		# Create new Item (ERPNext: fixed assets must be non-stock — validate_fixed_asset)
		is_fixed_asset = cint(item_row.is_asset_item)
		is_stock_item = 0 if is_fixed_asset else cint(item_row.is_stock_item)

		item = frappe.get_doc({
			"doctype": "Item",
			"item_code": item_row.generated_code,
			"item_name": item_row.item_name,
			"item_group": item_row.item_group,
			"description": item_row.description or item_row.item_name,
			"stock_uom": item_row.uom,
			"gst_hsn_code": item_row.hsn_code,
			"is_stock_item": is_stock_item,
			"is_fixed_asset": is_fixed_asset,
			"asset_category": item_row.asset_category if is_fixed_asset else None,
			"disabled": 0
		})
		
		# Add company defaults; expense account is optional for fixed asset items
		defaults_row = {
			"company": self.company or frappe.defaults.get_defaults().get("company"),
			"default_warehouse": "",  # Prevent invalid global defaults from Item Group
		}
		if item_row.expense_account:
			defaults_row["expense_account"] = item_row.expense_account
		item.append("item_defaults", defaults_row)
		
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
def get_leaf_item_groups_for_webform(txt=None, page_length=50):
	"""Return only leaf Item Groups for webform autocomplete."""
	txt = (txt or "").strip()
	page_length = cint(page_length) if page_length else 50
	page_length = min(max(page_length, 1), 1000)

	filters = {"is_group": 0}
	if txt:
		filters["name"] = ["like", f"%{txt}%"]

	rows = frappe.get_all(
		"Item Group",
		filters=filters,
		fields=["name", "parent_item_group"],
		limit_page_length=page_length,
		order_by="name asc",
	)

	return [
		{
			"value": row.name,
			"label": row.name,
			"description": row.parent_item_group,
		}
		for row in rows
	]

