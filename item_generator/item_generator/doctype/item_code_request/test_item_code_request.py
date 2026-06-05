# Copyright (c) 2024, Pratul Tiwari and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase


class TestItemCodeRequest(FrappeTestCase):
	def setUp(self):
		"""Set up test data"""
		# Create test roles if they don't exist
		self.create_test_roles()
		# Create test item group if it doesn't exist
		self.create_test_item_group()
	
	def create_test_roles(self):
		"""Create test roles if they don't exist"""
		roles = ["Store User", "Codification User", "Item Manager"]
		for role in roles:
			if not frappe.db.exists("Role", role):
				frappe.get_doc({
					"doctype": "Role",
					"role_name": role
				}).insert(ignore_permissions=True)
	
	def create_test_item_group(self):
		"""Create a test item group"""
		if not frappe.db.exists("Item Group", "Test Item Group"):
			frappe.get_doc({
				"doctype": "Item Group",
				"item_group_name": "Test Item Group",
				"parent_item_group": "All Item Groups",
				"is_group": 0
			}).insert(ignore_permissions=True)
	
	def test_item_code_request_creation(self):
		"""Test creating an Item Code Request"""
		company = frappe.db.get_value("Company", {"name": ("!=", "")}, "name")
		cost_center = frappe.db.get_value("Cost Center", {"company": company, "is_group": 0}, "name")
		if not company or not cost_center:
			self.skipTest("Company or Cost Center not found - skipping")
		doc = frappe.get_doc({
			"doctype": "Item Code Request",
			"company": company,
			"cost_center": cost_center,
			"mobile": "9999999999",
			"items": [
				{
					"item_name": "Test Item",
					"description": "Test Description",
					"item_group": "Test Item Group",
					"is_stock_item": 1,
					"is_asset_item": 0,
				}
			],
		})
		doc.insert()
		self.assertTrue(doc.name)
		# Clean up
		doc.delete()
	
	def test_asset_category_validation(self):
		"""Test that asset_category is required when is_asset_item is checked"""
		company = frappe.db.get_value("Company", {"name": ("!=", "")}, "name")
		cost_center = frappe.db.get_value("Cost Center", {"company": company, "is_group": 0}, "name")
		if not company or not cost_center:
			self.skipTest("Company or Cost Center not found - skipping")
		doc = frappe.get_doc({
			"doctype": "Item Code Request",
			"company": company,
			"cost_center": cost_center,
			"mobile": "9999999999",
			"items": [
				{
					"item_name": "Test Asset Item",
					"description": "Test Asset Description",
					"item_group": "Test Item Group",
					"is_stock_item": 0,
					"is_asset_item": 1,
				}
			],
		})
		with self.assertRaises((frappe.ValidationError, frappe.MandatoryError)):
			doc.insert()

	def test_duplicate_generated_code_validation(self):
		"""Generated Code must be unique within the same request."""
		company = frappe.db.get_value("Company", {"name": ("!=", "")}, "name")
		cost_center = frappe.db.get_value("Cost Center", {"company": company, "is_group": 0}, "name")
		if not company or not cost_center:
			self.skipTest("Company or Cost Center not found - skipping")

		doc = frappe.get_doc({
			"doctype": "Item Code Request",
			"company": company,
			"cost_center": cost_center,
			"mobile": "9999999999",
			"items": [
				{
					"item_name": "Duplicate Code Item A",
					"description": "Duplicate Code Item A Description",
					"item_group": "Test Item Group",
					"is_stock_item": 1,
					"is_asset_item": 0,
					"uom": "Nos",
					"generated_code": "TEST-GENCODE-DUP-001",
				},
				{
					"item_name": "Duplicate Code Item B",
					"description": "Duplicate Code Item B Description",
					"item_group": "Test Item Group",
					"is_stock_item": 1,
					"is_asset_item": 0,
					"uom": "Nos",
					"generated_code": "TEST-GENCODE-DUP-001",
				},
			],
		})

		with self.assertRaises(frappe.ValidationError):
			doc.insert()

	def test_generated_code_reuse_validation(self):
		"""Generated code reused from another request should be blocked."""
		company = frappe.db.get_value("Company", {"name": ("!=", "")}, "name")
		cost_center = frappe.db.get_value("Cost Center", {"company": company, "is_group": 0}, "name")
		if not company or not cost_center:
			self.skipTest("Company or Cost Center not found - skipping")

		generated_code = "TEST-GENCODE-REUSE-001"
		hsn_code = frappe.db.get_value("GST HSN Code", {"name": ("!=", "")}, "name")
		if not hsn_code:
			self.skipTest("GST HSN Code not found - skipping")

		source_doc = frappe.get_doc({
			"doctype": "Item Code Request",
			"company": company,
			"cost_center": cost_center,
			"mobile": "9999999999",
			"items": [
				{
					"item_name": "Source Request Item",
					"description": "Source Request Description",
					"item_group": "Test Item Group",
					"is_stock_item": 1,
					"is_asset_item": 0,
					"uom": "Nos",
					"generated_code": generated_code,
				}
			],
		})
		source_doc.insert()

		frappe.get_doc({
			"doctype": "Item",
			"item_code": generated_code,
			"item_name": "Existing Item For Reused Code",
			"description": "Existing Item Description",
			"item_group": "Test Item Group",
			"stock_uom": "Nos",
			"is_stock_item": 1,
			"gst_hsn_code": hsn_code,
		}).insert(ignore_permissions=True)

		target_doc = frappe.get_doc({
			"doctype": "Item Code Request",
			"company": company,
			"cost_center": cost_center,
			"mobile": "9999999999",
			"items": [
				{
					"item_name": "Target Request Item",
					"description": "Target Request Description",
					"item_group": "Test Item Group",
					"is_stock_item": 1,
					"is_asset_item": 0,
					"uom": "Nos",
					"generated_code": generated_code,
				}
			],
		})

		with self.assertRaises(frappe.ValidationError):
			target_doc.insert()
	
	def tearDown(self):
		"""Clean up after tests"""
		frappe.db.rollback()
























