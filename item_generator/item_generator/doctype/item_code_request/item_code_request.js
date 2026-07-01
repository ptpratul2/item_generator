// Copyright (c) 2024, Pratul Tiwari and contributors
// For license information, please see license.txt

// Review / Send to Ecode / Discard should not block on mandatory fields.
(function () {
	const SKIP_MANDATORY_ACTIONS = new Set([
		"reject", // backward compatibility
		"review",
		"review to ecode",
		"send to ecode",
		"discard"
	]);

	const should_skip_mandatory = (frm) => {
		const action = (frm.selected_workflow_action || "").trim().toLowerCase();
		return frm.doctype === "Item Code Request" && SKIP_MANDATORY_ACTIONS.has(action);
	};

	const original_check_mandatory = frappe.ui.form.check_mandatory;
	frappe.ui.form.check_mandatory = function (frm) {
		if (should_skip_mandatory(frm)) {
			return true;
		}
		return original_check_mandatory(frm);
	};
})();

frappe.ui.form.on('Item Code Request', {
	setup: function (frm) {
		frm.set_query('cost_center', function () {
			return {
				filters: {
					'company': frm.doc.company
				}
			};
		});

		frm.set_query('department', function () {
			return {
				filters: {
					'company': frm.doc.company
				}
			};
		});

		frm.set_query('expense_account', 'items', function () {
			return {
				filters: {
					'company': frm.doc.company,
					'is_group': 0
				}
			};
		});
	},

	refresh: function (frm) {
		// Show notification for Codification Users
		if (frappe.user.has_role('Codification User') &&
			frm.doc.workflow_state === 'Pending Codification' &&
			frm.doc.docstatus === 0) {

			// Check if all items have generated codes
			let items_without_code = frm.doc.items.filter(item => !item.generated_code).length;

			if (items_without_code > 0) {
				frm.dashboard.add_comment(
					__(`Please add Generated Codes for ${items_without_code} item(s).`),
					'blue',
					true
				);
			}
		}

		// Add custom buttons for Approved state
		if (frm.doc.workflow_state === 'Approved' && frm.doc.docstatus === 1) {
			// Add button to view created items
			if (frm.doc.items_created > 0) {
				frm.add_custom_button(__('View Created Items'), function () {
					let created_items = frm.doc.items.filter(item => item.item_created);
					if (created_items.length === 1) {
						frappe.set_route('Form', 'Item', created_items[0].generated_code);
					} else {
						// Show list of created items
						frappe.route_options = {
							"item_code": ["in", created_items.map(item => item.generated_code)]
						};
						frappe.set_route('List', 'Item');
					}
				});
			}

			// Add button to create remaining items
			let items_to_create = frm.doc.items.filter(
				item => item.generated_code && !item.item_created
			).length;

			if (items_to_create > 0) {
				frm.add_custom_button(__(`Create ${items_to_create} Item(s)`), function () {
					frappe.confirm(
						__(`Do you want to create ${items_to_create} item(s) in ERPNext?`),
						function () {
							frm.save('Update');
						}
					);
				});
			}
		}

		// Update summary on refresh
		update_summary(frm);
	},

	validate: function (frm) {
		// Update summary before save
		update_summary(frm);
	},

	before_workflow_action: function (frm) {
		const action = (frm.selected_workflow_action || '').trim().toLowerCase();
		if (
			action === 'review' ||
			action === 'review to ecode' ||
			action === 'send to ecode' ||
			action === 'discard'
		) {
			return;
		}
		if (
			frm.doc.workflow_state === 'Pending Codification' &&
			frm.selected_workflow_action === 'Add Code'
		) {
			let items_without_code = frm.doc.items.filter((item) => !item.generated_code).length;
			if (items_without_code > 0) {
				frappe.throw(
					__('Please add Generated Codes for {0} item(s).', [items_without_code])
				);
			}
			let asset_items_without_code = frm.doc.items.filter(
				(item) => item.is_asset_item && !(item.asset_code || '').trim()
			).length;
			if (asset_items_without_code > 0) {
				frappe.throw(
					__('Please add Asset Codes for {0} asset item(s).', [asset_items_without_code])
				);
			}
		}
	},

	cost_center: function (frm) {
		if (frm.doc.cost_center) {
			frappe.db.get_value('Cost Center', frm.doc.cost_center, 'company')
				.then(r => {
					if (r && r.message && r.message.company) {
						frm.set_value('company', r.message.company);
					}
				});
		}
	}
});

// Child table events
frappe.ui.form.on('Item Code Request Item', {
	items_add: function (frm, cdt, cdn) {
		update_summary(frm);
	},

	items_remove: function (frm, cdt, cdn) {
		update_summary(frm);
	},

	generated_code: function (frm, cdt, cdn) {
		update_summary(frm);
	},

	is_asset_item: function (frm, cdt, cdn) {
		let row = locals[cdt][cdn];
		if (row.is_asset_item) {
			// ERPNext: fixed asset items must be non-stock
			frappe.model.set_value(cdt, cdn, 'is_stock_item', 0);
		}
		if (!row.is_asset_item) {
			frappe.model.set_value(cdt, cdn, 'asset_category', '');
		}
		frm.refresh_field('items');
	},

	item_name: function (frm, cdt, cdn) {
		// Auto-refresh the grid
		frm.refresh_field('items');
	}
});

// Helper function to update summary
function update_summary(frm) {
	if (!frm.doc.items) {
		frm.set_value('total_items', 0);
		frm.set_value('items_with_code', 0);
		frm.set_value('items_created', 0);
		return;
	}

	let total_items = frm.doc.items.length;
	let items_with_code = frm.doc.items.filter(item => item.generated_code).length;
	let items_created = frm.doc.items.filter(item => item.item_created).length;

	frm.set_value('total_items', total_items);
	frm.set_value('items_with_code', items_with_code);
	frm.set_value('items_created', items_created);
}

// Custom field rendering for generated_code in child table
frappe.ui.form.on('Item Code Request Item', {
	form_render: function (frm, cdt, cdn) {
		let row = locals[cdt][cdn];
		let grid_row = frm.fields_dict.items.grid.grid_rows_by_docname[cdn];

		// Make generated_code editable only for Codification Users in Pending Codification state
		if (frappe.user.has_role('Codification User') &&
			frm.doc.workflow_state === 'Pending Codification' &&
			frm.doc.docstatus === 0) {
			// Field is editable
			if (grid_row) {
				grid_row.toggle_editable('generated_code', true);
			}
		} else {
			// Field is read-only
			if (grid_row) {
				grid_row.toggle_editable('generated_code', false);
			}
		}
	}
});
