/**
 * Similar Item Detection for Item Code Request WebForm
 *
 * Shows similar existing items when user types item_name or description
 * to prevent duplicate item creation.
 */

frappe.ready(function () {
	// Only run on Item Code Request Form (web form with items table)
	if (!frappe.web_form_doc || frappe.web_form_doc.doc_type !== "Item Code Request") {
		return;
	}

	const DEBOUNCE_MS = 500;
	const MIN_QUERY_LENGTH = 3;
	let debounceTimer = null;
	let $suggestionBox = null;

	/**
	 * Normalize search input: lowercase, trim, collapse spaces
	 */
	function normalizeQuery(str) {
		if (!str || typeof str !== "string") return "";
		return str
			.toLowerCase()
			.trim()
			.replace(/\s+/g, " ");
	}

	/**
	 * Build search query from item_name + description of a row
	 */
	function getQueryFromRow($row) {
		const getVal = (fieldname) => {
			const $control = $row.find(`[data-fieldname="${fieldname}"]`);
			const $input = $control.find("input, textarea");
			return ($input.length ? $input.val() : "") || "";
		};
		const itemName = String(getVal("item_name") || "").trim();
		const description = String(getVal("description") || "").trim();
		return normalizeQuery(itemName + " " + description);
	}

	/**
	 * Show suggestion box with similar items
	 */
	function showSuggestions(items, $anchor) {
		hideSuggestions();

		if (!items || items.length === 0) {
			return;
		}

		const $container = $anchor.closest(".form-group") || $(".web-form-wrapper");
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
			const scoreText = item.score ? ` (${item.score}% match)` : "";
			const itemPath = `/app/item/${encodeURIComponent(item.name)}`;
			const itemUrl = (frappe.urllib && frappe.urllib.get_full_url)
				? frappe.urllib.get_full_url(itemPath)
				: `${window.location.origin}${itemPath}`;
			const $link = $(`
				<a href="${itemUrl}" target="_blank" rel="noopener" class="similar-item-link">
					${frappe.utils.escape_html(item.item_code)} | ${frappe.utils.escape_html(item.item_name)}${scoreText}
				</a>
			`);
			$list.append($link);
		});

		// Position: try below row, then items section, then form body (ensure visibility)
		const $row = $anchor.closest(".grid-row, .grid-row-open") || $anchor.closest(".rows > div") || $anchor.closest(".form-in-grid");
		const $itemsSection = $(".web-form-wrapper [data-fieldname='items']").closest(".form-group");
		const $formGrid = $(".web-form-wrapper .form-grid-container, .web-form-wrapper .grid-field");

		if ($row.length) {
			$suggestionBox.insertAfter($row);
		} else if ($formGrid.length) {
			$suggestionBox.insertAfter($formGrid.last());
		} else if ($itemsSection.length) {
			$suggestionBox.insertAfter($itemsSection);
		} else {
			$suggestionBox.appendTo($(".web-form-body").first() || $(".web-form-wrapper").first() || $("body"));
		}

		$suggestionBox.show();
		$suggestionBox[0].scrollIntoView({ behavior: "smooth", block: "nearest" });
	}

	/**
	 * Hide suggestion box
	 */
	function hideSuggestions() {
		if ($suggestionBox) {
			$suggestionBox.slideUp(200, function () {
				$(this).remove();
			});
			$suggestionBox = null;
		}
	}

	/**
	 * Fetch similar items from backend and display
	 */
	function fetchAndShowSimilarItems(query, $triggerInput) {
		if (query.length < MIN_QUERY_LENGTH) {
			hideSuggestions();
			return;
		}

		frappe.call({
			method: "item_generator.api.item_similarity.get_similar_items",
			args: { query: query },
			callback: function (r) {
				if (r.message && r.message.length > 0) {
					showSuggestions(r.message, $triggerInput);
				} else {
					hideSuggestions();
				}
			},
			error: function () {
				hideSuggestions();
			},
		});
	}

	/**
	 * Debounced handler for item_name / description input
	 */
	function onItemFieldInput(e) {
		const $input = $(e.target);
		// Get fieldname from input or its parent control (web form may use different structure)
		const $control = $input.closest("[data-fieldname]");
		const fieldname = $input.attr("data-fieldname") || ($control.length ? $control.attr("data-fieldname") : "");

		// Items grid: check by data-fieldname, grid-body, rows, form-grid, or form-in-grid
		const $itemsGrid = $input.closest("[data-fieldname='items']");
		const $anyGrid = $input.closest(".grid-body, .rows, .form-grid, .form-in-grid");
		if (!$itemsGrid.length && !$anyGrid.length) return;

		// Accept item_name, description, or any input in items grid (web form may omit data-fieldname)
		if (fieldname && fieldname !== "item_name" && fieldname !== "description") return;

		// Find row for getQueryFromRow
		const $row = $input.closest(".grid-row, .grid-row-open") || $input.parent();

		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(function () {
			let query = getQueryFromRow($row);
			// Fallback: use input value directly if getQueryFromRow returns empty
			if (!query && $input.val()) {
				query = normalizeQuery(String($input.val() || ""));
			}
			if (query.length >= MIN_QUERY_LENGTH) {
				fetchAndShowSimilarItems(query, $input);
			} else {
				hideSuggestions();
			}
		}, DEBOUNCE_MS);
	}

	// Event delegation: match inputs in items grid (broad selectors for inline + expanded row)
	$(document).on(
		"input change keyup",
		".web-form-wrapper [data-fieldname='items'] input, .web-form-wrapper [data-fieldname='items'] textarea, " +
			".web-form-wrapper .grid-body input, .web-form-wrapper .grid-body textarea, " +
			".web-form-wrapper .rows input, .web-form-wrapper .rows textarea, " +
			".web-form-wrapper .form-grid input, .web-form-wrapper .form-grid textarea, " +
			".web-form-wrapper .form-in-grid input, .web-form-wrapper .form-in-grid textarea, " +
			".web-form [data-fieldname='items'] input, .web-form [data-fieldname='items'] textarea",
		onItemFieldInput
	);

	// Hide suggestions when clicking outside (keep visible when clicking in form/grid)
	$(document).on("click", function (e) {
		if (
			$suggestionBox &&
			!$(e.target).closest(".similar-items-suggestion-box").length &&
			!$(e.target).closest("[data-fieldname='items'], .grid-body, .form-in-grid, .form-grid").length
		) {
			hideSuggestions();
		}
	});

	// Hide when primary action (submit) is clicked
	$(".web-form-wrapper").on("click", ".submit-btn, .btn-primary", function () {
		hideSuggestions();
	});
});



