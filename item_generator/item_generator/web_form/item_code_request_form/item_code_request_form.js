frappe.ready(function () {
	let cached_leaf_item_group_options = null;
	let leaf_item_group_request = null;

	let get_items_grid = function () {
		return frappe.web_form.fields_dict.items && frappe.web_form.fields_dict.items.grid
			? frappe.web_form.fields_dict.items.grid
			: null;
	};

	let get_leaf_item_group_options = function () {
		if (cached_leaf_item_group_options) {
			return Promise.resolve(cached_leaf_item_group_options);
		}
		if (leaf_item_group_request) {
			return leaf_item_group_request;
		}

		leaf_item_group_request = new Promise((resolve) => {
			frappe.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Item Group",
					fields: ["name", "parent_item_group"],
					filters: {
						is_group: 0
					},
					order_by: "name asc",
					limit_page_length: 1000
				},
				callback: function (r) {
					cached_leaf_item_group_options = (r.message || []).map((row) => ({
						value: row.name,
						label: row.name,
						description: row.parent_item_group || ""
					}));
					resolve(cached_leaf_item_group_options);
				},
				error: function () {
					resolve([]);
				},
				always: function () {
					leaf_item_group_request = null;
				}
			});
		});

		return leaf_item_group_request;
	};

	let apply_item_group_options_to_grid = function (options) {
		let grid = get_items_grid();
		if (!grid) return;

		let item_group_field = grid.get_field("item_group");
		if (item_group_field && item_group_field.df) {
			item_group_field.df.options = options;
		}

		if (grid.docfields) {
			let item_group_df = grid.docfields.find((df) => df.fieldname === "item_group");
			if (item_group_df) {
				item_group_df.options = options;
			}
		}

		(grid.grid_rows || []).forEach((row) => {
			let inline_control = row?.columns?.item_group?.field;
			if (inline_control) {
				inline_control.df.options = options;
				inline_control.get_query = null;
				inline_control.df.get_query = null;
				if (inline_control.set_data) inline_control.set_data(options);
			}

			let form_control = row?.grid_form?.fields_dict?.item_group;
			if (form_control) {
				form_control.df.options = options;
				form_control.get_query = null;
				form_control.df.get_query = null;
				if (form_control.set_data) form_control.set_data(options);
			}
		});
	};

	// Function to set filter on child table field
	let set_expense_account_filter = function (company) {
		let grid = get_items_grid();
		if (!grid) return false;

		const company_value = company || frappe.web_form.get_value("company");
		let query_fn = function () {
			return {
				filters: {
					company: company_value,
					is_group: 0
				}
			};
		};

		let expense_field = grid.get_field("expense_account");
		if (expense_field) {
			expense_field.get_query = query_fn;
			if (expense_field.df) expense_field.df.get_query = query_fn;
		}

		if (grid.docfields) {
			let expense_df = grid.docfields.find((df) => df.fieldname === "expense_account");
			if (expense_df) expense_df.get_query = query_fn;
		}

		return !!expense_field;
	};

	// Show only leaf Item Groups in child table item_group link
	let set_item_group_filter = function () {
		let grid = get_items_grid();
		if (!grid) return false;

		let item_group_field = grid.get_field("item_group");
		if (item_group_field) {
			item_group_field.get_query = null;
			if (item_group_field.df) item_group_field.df.get_query = null;
		}

		if (grid.docfields) {
			let item_group_df = grid.docfields.find((df) => df.fieldname === "item_group");
			if (item_group_df) {
				item_group_df.get_query = null;
			}
		}

		get_leaf_item_group_options().then((options) => {
			apply_item_group_options_to_grid(options);
		});

		return !!item_group_field;
	};

	// Web form may render table controls asynchronously; retry until filters are bound.
	let bind_grid_filters = function (retry = 0) {
		let has_item_group_filter = set_item_group_filter();
		let has_expense_filter = set_expense_account_filter();

		if (
			(!has_item_group_filter || !has_expense_filter) &&
			retry < 10
		) {
			setTimeout(() => bind_grid_filters(retry + 1), 300);
		}
	};

	let ensure_request_date_value = function () {
		let request_date = frappe.web_form.get_value("request_date");
		if (!request_date || request_date === "Today" || request_date === "current_date") {
			frappe.web_form.set_value("request_date", frappe.datetime.nowdate());
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
		bind_grid_filters();
	});

	// Default Requested By to logged-in user's email (login ID)
	if (frappe.session.user && frappe.session.user !== "Guest") {
		if (!frappe.web_form.get_value("requested_by")) {
			frappe.web_form.set_value("requested_by", frappe.session.user);
		}
	}

	// Trigger on load
	let company = frappe.web_form.get_value('company');
	let cost_center_load = frappe.web_form.get_value('cost_center');
	ensure_request_date_value();
	bind_grid_filters();
	get_leaf_item_group_options().then((options) => {
		apply_item_group_options_to_grid(options);
	});

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

	// ========== Similar Item Detection ==========
	initSimilarItemDetection();

	function initSimilarItemDetection() {
		// Inject CSS (webform_include_css may not load if form has no .css file)
		if (!$("#similar-items-suggestion-css").length) {
			$("head").append(`
				<style id="similar-items-suggestion-css">
					.similar-items-suggestion-box {
						display: block !important;
						width: 100%;
						clear: both;
						margin: 12px 0;
						padding: 12px 16px;
						background: #fff8e6;
						border: 1px solid #ffc107;
						border-radius: 6px;
						box-shadow: 0 2px 8px rgba(0,0,0,0.08);
						z-index: 1050;
						position: relative;
						flex-basis: 100%;
					}
					.similar-items-header { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; font-size: 13px; }
					.similar-items-list { display: flex; flex-direction: column; gap: 6px; }
					.similar-item-link {
						display: block;
						padding: 6px 10px;
						background: #fff;
						border-radius: 4px;
						text-decoration: none;
						color: #2490ef;
						font-size: 13px;
					}
					.similar-item-link:hover { background: #f5f7fa; text-decoration: underline; }
				</style>
			`);
		}

		const DEBOUNCE_MS = 500;
		const MIN_QUERY_LENGTH = 3;
		let debounceTimer = null;
		let $suggestionBox = null;

		function normalizeQuery(str) {
			if (!str || typeof str !== "string") return "";
			return String(str).toLowerCase().trim().replace(/\s+/g, " ");
		}

		function showSuggestions(items, $anchor) {
			hideSuggestions();
			if (!items || items.length === 0) return;

			$suggestionBox = $(`
				<div class="similar-items-suggestion-box">
					<div class="similar-items-header">
						<span class="text-warning">${frappe.utils.icon("warning", "sm")}</span>
						<strong>${__("Similar Items Found")}</strong>
					</div>
					<div class="similar-items-list"></div>
				</div>
			`);

			const $list = $suggestionBox.find(".similar-items-list");
			items.forEach((item) => {
				const scoreText = item.score ? ` (${Math.round(item.score)}% match)` : "";
				const itemUrl = `${window.location.origin}/app/item/${encodeURIComponent(item.name)}`;
				$list.append(
					$(`<a href="${itemUrl}" target="_blank" rel="noopener" class="similar-item-link"></a>`)
						.text(`${item.item_code} | ${item.item_name}${scoreText}`)
				);
			});

			// Placement: inline row = below entire row; expanded row = below item_name field
			const $gridRow = $anchor && $anchor.closest(".grid-row");
			const $formInGrid = $anchor && $anchor.closest(".form-in-grid");

			if ($formInGrid.length) {
				// Expanded row: insert below item_name in the form
				const $itemNameControl = $formInGrid.find("[data-fieldname='item_name']").first();
				if ($itemNameControl.length) {
					$suggestionBox.insertAfter($itemNameControl);
				} else {
					$suggestionBox.insertAfter($formInGrid.find(".form-area").first() || $formInGrid);
				}
			} else if ($gridRow && $gridRow.length) {
				// Inline row: insert below the entire row (full-width, not beside columns)
				$suggestionBox.insertAfter($gridRow);
			} else {
				const $itemsGrid = $(".web-form-wrapper [data-fieldname='items']").closest(".form-group, .grid-field");
				const $grid = $itemsGrid.length ? $itemsGrid : $(".web-form-wrapper .form-grid-container").last();
				if ($grid.length) {
					$suggestionBox.insertAfter($grid);
				} else {
					$suggestionBox.appendTo($(".web-form-body").first() || $("body"));
				}
			}
			$suggestionBox.show();
			$suggestionBox[0].scrollIntoView({ behavior: "smooth", block: "nearest" });
		}

		function hideSuggestions() {
			if ($suggestionBox) {
				$suggestionBox.remove();
				$suggestionBox = null;
			}
			// Remove any orphaned boxes (e.g. from duplicate script runs)
			$(".similar-items-suggestion-box").remove();
		}

		function fetchAndShow(query, $input) {
			if (query.length < MIN_QUERY_LENGTH) {
				hideSuggestions();
				return;
			}
			frappe.call({
				method: "item_generator.api.item_similarity.get_similar_items",
				args: { query: query },
				callback: function (r) {
					if (r.message && r.message.length > 0) {
						showSuggestions(r.message, $input);
					} else {
						hideSuggestions();
					}
				},
				error: function () {
					hideSuggestions();
				},
			});
		}

		function onInput(e) {
			const $input = $(e.target);
			const $grid = $input.closest(".grid-body, .rows, .form-grid, .form-in-grid, [data-fieldname='items']");
			if (!$grid.length) return;

			// Only search when typing in item_name or description (allow unknown = search on any text field in items grid)
			const $control = $input.closest("[data-fieldname]");
			const $col = $input.closest(".grid-static-col");
			let fieldname = ($input.attr("data-fieldname") || ($control.length ? $control.attr("data-fieldname") : "") || ($col.length ? $col.attr("data-fieldname") : "") || "").toLowerCase();
			// Skip non-text fields (Link, Check, etc.)
			const skipFields = ["item_group", "uom", "expense_account", "asset_category", "hsn_code", "is_stock_item", "is_asset_item", "generated_code", "item_created", "name"];
			if (fieldname && skipFields.includes(fieldname)) return;
			if (!fieldname || (fieldname !== "item_name" && fieldname !== "description")) fieldname = "";

			clearTimeout(debounceTimer);
			debounceTimer = setTimeout(function () {
				const $gridRow = $input.closest(".grid-row");
				const $row = $input.closest(".grid-row, .form-in-grid, .data-row, .rows > div");
				// Use grid-row as search root (contains both inline .data-row and expanded .form-in-grid)
				const $searchRoot = $gridRow.length ? $gridRow : $row;
				let query = "";

				// Current field value from the input we're typing in (always up-to-date)
				const currentVal = normalizeQuery(($input.val && $input.val()) || $input.text() || "");

				const getFieldVal = (f) => {
					if (!f) return "";
					if (f.$input && f.$input.length) return (f.$input.val() || "").trim();
					if (f.get_input_value) return (f.get_input_value() || "").trim();
					if (f.get_value) return (f.get_value() || "").trim();
					return "";
				};
				const getValFromDom = (fn) => {
					if (!$searchRoot.length) return "";
					// Inline editable: .grid-static-col[data-fieldname], .frappe-control[data-fieldname], or input[data-fieldname]
					const sel = `[data-fieldname="${fn}"] input, [data-fieldname="${fn}"] textarea, .grid-static-col[data-fieldname="${fn}"] input, .grid-static-col[data-fieldname="${fn}"] textarea, .frappe-control[data-fieldname="${fn}"] input, .frappe-control[data-fieldname="${fn}"] textarea, input[data-fieldname="${fn}"], textarea[data-fieldname="${fn}"]`;
					const $el = $searchRoot.find(sel).first();
					return ($el.length ? (($el.val && $el.val()) || $el.text() || "") : "") || "";
				};

				// Build query: use current input value for the field we're typing in
				let itemName = "";
				let desc = "";
				const gridRow = $gridRow.length && $gridRow.data("grid_row");
				const fd = gridRow && gridRow.grid_row_form && gridRow.grid_row_form.fields_dict;
				// In inline mode, grid_row_form may have stale data; prefer DOM values
				const inExpandedForm = $input.closest(".form-in-grid").length > 0;

				if (fieldname === "item_name") {
					itemName = currentVal;
					desc = (inExpandedForm && fd) ? getFieldVal(fd.description) : (getValFromDom("description") || "").trim();
				} else if (fieldname === "description") {
					itemName = (inExpandedForm && fd) ? getFieldVal(fd.item_name) : (getValFromDom("item_name") || "").trim();
					desc = currentVal;
				} else {
					// Unknown field: try all sources
					if (fd) {
						itemName = getFieldVal(fd.item_name);
						desc = getFieldVal(fd.description);
					} else if (gridRow && gridRow.doc) {
						itemName = String(gridRow.doc.item_name || "").trim();
						desc = String(gridRow.doc.description || "").trim();
					} else if ($searchRoot.length) {
						itemName = (getValFromDom("item_name") || "").trim();
						desc = (getValFromDom("description") || "").trim();
					}
					// Fallback: frappe.web_form.get_values() for grid data
					if ((!itemName && !desc) && frappe.web_form && frappe.web_form.get_values) {
						try {
							const doc = frappe.web_form.get_values();
							const idx = $gridRow.length && parseInt($gridRow.attr("data-idx"), 10);
							if (doc && doc.items && idx && doc.items[idx - 1]) {
								const row = doc.items[idx - 1];
								itemName = String(row.item_name || "").trim();
								desc = String(row.description || "").trim();
							}
						} catch (err) { /* ignore */ }
					}
					if (!itemName && !desc) itemName = currentVal;
				}
				query = normalizeQuery(itemName + " " + desc);
				if (!query) query = currentVal;
				if (query.length >= MIN_QUERY_LENGTH) {
					fetchAndShow(query, $input);
				} else {
					hideSuggestions();
				}
			}, DEBOUNCE_MS);
		}

		// Broad selectors: include inline editable row (.data-row, .editable-row, .grid-static-col)
		const inputSelectors =
			".web-form-wrapper [data-fieldname='items'] input, .web-form-wrapper [data-fieldname='items'] textarea, " +
			".web-form-wrapper [data-fieldname='items'] [contenteditable=true], " +
			".web-form-wrapper .grid-body input, .web-form-wrapper .grid-body textarea, " +
			".web-form-wrapper .rows input, .web-form-wrapper .rows textarea, " +
			".web-form-wrapper .data-row input, .web-form-wrapper .data-row textarea, " +
			".web-form-wrapper .editable-row input, .web-form-wrapper .editable-row textarea, " +
			".web-form-wrapper .grid-static-col input, .web-form-wrapper .grid-static-col textarea, " +
			".web-form-wrapper .form-in-grid input, .web-form-wrapper .form-in-grid textarea, " +
			".web-form-wrapper .form-in-grid [contenteditable=true], " +
			".web-form-wrapper .form-grid input, .web-form-wrapper .form-grid textarea, " +
			".web-form-wrapper .web-form-grid-row input, .web-form-wrapper .web-form-grid-row textarea, " +
			"form.web-form .form-grid input, form.web-form .form-grid textarea, " +
			".form-in-grid input, .form-in-grid textarea, .form-in-grid [contenteditable=true], " +
			".grid-body .data-row input, .grid-body .data-row textarea, " +
			".grid-body .editable-row input, .grid-body .editable-row textarea";
		$(document).on("input change keyup paste", inputSelectors, onInput);
		$(document).on("focus", inputSelectors, onInput);

		$(document).on("click", function (e) {
			if ($suggestionBox && !$(e.target).closest(".similar-items-suggestion-box").length && !$(e.target).closest("[data-fieldname='items'], .grid-body, .form-in-grid, .form-grid").length) {
				hideSuggestions();
			}
		});
	}
	// ========== End Similar Item Detection ==========

	$(document).on("focus click", ".web-form-wrapper [data-fieldname='item_group'] input", function () {
		let input = this;
		set_item_group_filter();
		get_leaf_item_group_options().then((options) => {
			apply_item_group_options_to_grid(options);
			if (input && input.awesomplete) {
				input.awesomplete.list = options;
				input.awesomplete.evaluate();
			}
		});
	});

	function validate_requested_by() {
		const requested_by = (frappe.web_form.get_value("requested_by") || "").trim();
		if (!requested_by) {
			return true;
		}
		if (!requested_by.includes("@")) {
			frappe.msgprint({
				title: __("Invalid Requested By"),
				message: __(
					"Please enter your registered email address (login ID), not your display name. Select your email from the dropdown list."
				),
				indicator: "red",
			});
			return false;
		}
		return true;
	}

	// Web form validate event
	frappe.web_form.validate = function () {
		if (!validate_requested_by()) {
			return false;
		}

		ensure_request_date_value();

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