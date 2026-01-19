# -*- coding: utf-8 -*-
# Copyright (c) 2024, Pratul Tiwari and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe
from frappe.model.document import Document

class ItemCodeRequestItem(Document):
	def validate(self):
		"""Validate Item Code Request Item"""
		if self.is_asset_item and not self.asset_category:
			frappe.throw("Asset Category is required when Is Asset Item is checked")
























