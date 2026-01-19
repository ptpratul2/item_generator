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
		doc = frappe.get_doc({
			"doctype": "Item Code Request",
			"item_name": "Test Item",
			"hsn_code": "1234",
			"description": "Test Description",
			"item_group": "Test Item Group",
			"is_stock_item": 1,
			"is_asset_item": 0
		})
		doc.insert()
		self.assertTrue(doc.name)
		
		# Clean up
		doc.delete()
	
	def test_asset_category_validation(self):
		"""Test that asset_category is required when is_asset_item is checked"""
		doc = frappe.get_doc({
			"doctype": "Item Code Request",
			"item_name": "Test Asset Item",
			"hsn_code": "1234",
			"description": "Test Asset Description",
			"item_group": "Test Item Group",
			"is_stock_item": 0,
			"is_asset_item": 1
		})
		
		with self.assertRaises(frappe.ValidationError):
			doc.insert()
	
	def tearDown(self):
		"""Clean up after tests"""
		frappe.db.rollback()
























