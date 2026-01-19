frappe.ready(function () {
	// Function to set filter on child table field
	let set_expense_account_filter = function (company) {
		if (frappe.web_form.fields_dict.items && frappe.web_form.fields_dict.items.grid) {
			let grid = frappe.web_form.fields_dict.items.grid;
			if (grid.get_field('expense_account')) {
				grid.get_field('expense_account').get_query = function () {
					return {
						filters: {
							'company': company,
							'is_group': 0
						}
					};
				};
			}
		}
	};

	// Hide item_created field from the grid as it's a status field
	if (frappe.web_form.fields_dict.items && frappe.web_form.fields_dict.items.grid) {
		let grid = frappe.web_form.fields_dict.items.grid;
		// Check if the field exists in the grid's fields_map
		if (grid.fields_map) {
			if (grid.fields_map.item_created) grid.fields_map.item_created.hidden = 1;
			if (grid.fields_map.name) grid.fields_map.name.hidden = 1;
			if (grid.fields_map.expense_account) grid.fields_map.expense_account.hidden = 1;
			grid.refresh();
		}
	}

	// Listen for Cost Center change
	frappe.web_form.on('cost_center', (field, value) => {
		if (value) {
			frappe.call({
				method: 'frappe.client.get_value',
				args: {
					doctype: 'Cost Center',
					fieldname: 'company',
					filters: { name: value }
				},
				callback: function (r) {
					if (r.message && r.message.company) {
						frappe.web_form.set_value('company', r.message.company);
					}
				}
			});
		}
	});

	// Listen for Company change (to update filter)
	frappe.web_form.on('company', (field, value) => {
		if (value) {
			set_expense_account_filter(value);
		}
	});

	// Trigger on load
	// Trigger on load
	let company = frappe.web_form.get_value('company');
	let cost_center_load = frappe.web_form.get_value('cost_center');

	if (company) {
		set_expense_account_filter(company);
	}

	// Always validate/fetch company if cost_center is present on load
	// This ensures that even if a default company is set, it gets corrected to match the cost center
	if (cost_center_load) {
		frappe.call({
			method: 'frappe.client.get_value',
			args: {
				doctype: 'Cost Center',
				fieldname: 'company',
				filters: { name: cost_center_load }
			},
			callback: function (r) {
				if (r.message && r.message.company) {
					// Only update if different
					if (frappe.web_form.get_value('company') !== r.message.company) {
						frappe.web_form.set_value('company', r.message.company);
					}
					// Ensure filter is set correctly
					set_expense_account_filter(r.message.company);
				}
			}
		});
	} else if (company && !cost_center_load) {
		// If company is set (default) but no cost center, clear it to avoid confusion
		frappe.web_form.set_value('company', '');
	}

	// Web form validate event
	frappe.web_form.validate = function () {
		// Reset item_created to 0 for all items (safety check)
		let data = frappe.web_form.get_values();
		if (data.items) {
			data.items.forEach(item => {
				if (item.item_created == 1) {
					item.item_created = 0;
				}
			});
			// Update the web form's internal values with the modified items
			frappe.web_form.set_values({ items: data.items });
		}
		return true;
	};
})