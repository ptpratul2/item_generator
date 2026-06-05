frappe.pages["item-generator-analytics"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Live Analytics"),
		single_column: true,
	});

	frappe.require("/assets/item_generator/css/item_generator_analytics.css", () => {
		const analytics = new ItemGeneratorAnalytics(page);
		$(wrapper).bind("show", () => analytics.refresh());
		analytics.refresh();
	});
};

class ItemGeneratorAnalytics {
	constructor(page) {
		this.page = page;
		this.wrapper = $(page.body);
		this.refresh_interval_sec = 30;
		this.refresh_timer = null;
		this.charts = {};
		this.render_layout();
	}

	render_layout() {
		this.wrapper.html(`
			<div class="item-generator-analytics">
				<div class="iga-header">
					<div>
						<div class="iga-section-title" style="font-size:16px;margin-bottom:4px;">
							${__("Live Analytics")}
						</div>
						<div class="text-muted small">${__("Item Code Request — realtime KPIs, charts & breakdowns")}</div>
						<div class="iga-meta iga-refreshed-at"></div>
					</div>
					<div class="iga-header-actions">
						<button class="btn btn-default btn-sm btn-clear-filters">${__("Clear Filters")}</button>
						<button class="btn btn-default btn-sm btn-refresh">${__("Refresh")}</button>
					</div>
				</div>

				<div class="iga-filters-card">
					<div class="iga-filters-toolbar">
						<div class="iga-section-title">${__("Filters")}</div>
						<div class="iga-filters-actions">
							<button type="button" class="btn btn-default btn-sm btn-clear-filters">${__("Clear")}</button>
							<button type="button" class="btn btn-primary btn-sm btn-apply-filters">${__("Apply Filters")}</button>
						</div>
					</div>
					<div class="iga-filters-row"></div>
				</div>

				<div class="iga-kpi-grid"></div>

				<div class="iga-charts">
					<div class="iga-chart-box">
						<div class="iga-section-title">${__("Requests by Status")}</div>
						<div id="chart-status" class="chart-container"></div>
					</div>
					<div class="iga-chart-box">
						<div class="iga-section-title">${__("Requests Over Time")}</div>
						<div id="chart-timeline" class="chart-container"></div>
					</div>
					<div class="iga-chart-box full-width">
						<div class="iga-section-title">${__("Items Created by Item Group")}</div>
						<div id="chart-item-group" class="chart-container"></div>
					</div>
					<div class="iga-chart-box">
						<div class="iga-section-title">${__("Fixed Asset Items Created")}</div>
						<div id="chart-fixed-asset-timeline" class="chart-container"></div>
					</div>
					<div class="iga-chart-box">
						<div class="iga-section-title">${__("Asset Codes Entered")}</div>
						<div id="chart-asset-code-timeline" class="chart-container"></div>
					</div>
				</div>

				<div class="iga-charts">
					<div class="iga-table-box">
						<div class="iga-section-title">${__("By Requested By (User)")}</div>
						<div class="iga-table-wrap iga-table-requested-by"></div>
					</div>
					<div class="iga-table-box">
						<div class="iga-section-title">${__("By Cost Center")}</div>
						<div class="iga-table-wrap iga-table-cost-center"></div>
					</div>
					<div class="iga-table-box">
						<div class="iga-section-title">${__("By Company")}</div>
						<div class="iga-table-wrap iga-table-company"></div>
					</div>
				</div>
			</div>
		`);

		this.wrapper.find(".btn-refresh").on("click", () => this.refresh());
		this.wrapper.find(".btn-apply-filters").on("click", () => this.refresh());
		this.wrapper.find(".btn-clear-filters").on("click", () => this.clear_filters());
		this.render_filters();
	}

	render_filters() {
		const $row = this.wrapper.find(".iga-filters-row");
		$row.empty();
		this.filter_fields = {};

		const field_defs = [
			{ fieldname: "company", label: __("Company"), fieldtype: "Link", options: "Company" },
			{ fieldname: "cost_center", label: __("Cost Center"), fieldtype: "Link", options: "Cost Center" },
			{ fieldname: "requested_by", label: __("Requested By"), fieldtype: "Link", options: "User" },
			{
				fieldname: "workflow_state",
				label: __("Workflow State"),
				fieldtype: "Link",
				options: "Workflow State",
			},
			{ fieldname: "from_date", label: __("From Date"), fieldtype: "Date" },
			{ fieldname: "to_date", label: __("To Date"), fieldtype: "Date" },
		];

		field_defs.forEach((df) => {
			const $item = $(`
				<div class="iga-filter-item" data-fieldname="${df.fieldname}">
					<label class="iga-filter-label" for="iga-filter-${df.fieldname}">${df.label}</label>
					<div class="iga-filter-control"></div>
				</div>
			`);
			$row.append($item);

			const control = frappe.ui.form.make_control({
				df: {
					fieldtype: df.fieldtype,
					fieldname: df.fieldname,
					label: df.label,
					options: df.options,
					placeholder: df.label,
				},
				parent: $item.find(".iga-filter-control")[0],
				render_input: true,
			});
			control.make();
			control.refresh();
			this.filter_fields[df.fieldname] = control;
		});
	}

	clear_filters() {
		Object.values(this.filter_fields || {}).forEach((control) => {
			control.set_value("");
		});
		this.refresh();
	}

	get_filters() {
		const filters = {};
		Object.entries(this.filter_fields || {}).forEach(([fieldname, control]) => {
			const value = control.get_value();
			if (value !== null && value !== undefined && value !== "") {
				filters[fieldname] = value;
			}
		});
		return filters;
	}

	refresh() {
		this.wrapper.find(".iga-kpi-grid").html(`<div class="iga-loading col-span-full">${__("Loading...")}</div>`);

		frappe.call({
			method: "item_generator.api.dashboard.get_dashboard_stats",
			args: { filters: this.get_filters() },
			callback: (r) => {
				if (!r.message) {
					frappe.msgprint(__("Could not load analytics data."));
					return;
				}
				this.render_data(r.message);
				this.schedule_auto_refresh();
			},
			error: () => {
				this.wrapper.find(".iga-kpi-grid").html(
					`<div class="iga-no-data">${__("Failed to load data. Please refresh.")}</div>`
				);
			},
		});
	}

	schedule_auto_refresh() {
		if (this.refresh_timer) clearInterval(this.refresh_timer);
		this.refresh_timer = setInterval(() => {
			if (frappe.get_route_str() === "item-generator-analytics") {
				this.refresh();
			}
		}, this.refresh_interval_sec * 1000);
	}

	format_kpi(value) {
		const n = cint(value);
		return frappe.format(n, { fieldtype: "Int" });
	}

	format_chart_label(value) {
		if (value === null || value === undefined || value === "") {
			return __("Not Set");
		}
		if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
			return frappe.datetime.str_to_user(value);
		}
		return String(value);
	}

	render_data(data) {
		const s = data.summary || {};
		this.wrapper.find(".iga-refreshed-at").text(
			__("Auto-refresh every {0}s · Last updated: {1}", [
				this.refresh_interval_sec,
				frappe.datetime.str_to_user(data.refreshed_at),
			])
		);

		const kpis = [
			{ label: __("Total Item Requests"), value: s.total_requests },
			{ label: __("Total Items Requested"), value: s.total_items_requested },
			{ label: __("Total Codes Created"), value: s.total_items_created },
			{ label: __("Unique Requestors"), value: s.unique_requestors },
			{ label: __("Unique Cost Centers"), value: s.unique_cost_centers },
			{ label: __("Pending Codification"), value: s.pending_codification },
			{ label: __("Items With Code (Pending)"), value: s.items_pending_creation },
			{ label: __("Items Without Code"), value: s.items_without_code },
			{
				label: __("Fixed Asset Items Created"),
				value: s.fixed_asset_items_created,
				asset: true,
			},
			{ label: __("Asset Codes Entered"), value: s.asset_codes_entered, asset: true },
		];

		this.wrapper.find(".iga-kpi-grid").html(
			kpis
				.map(
					(k) => `
				<div class="iga-kpi${k.asset ? " iga-kpi-asset" : ""}">
					<div class="label">${k.label}</div>
					<div class="value">${this.format_kpi(k.value)}</div>
				</div>`
				)
				.join("")
		);

		this.render_chart("chart-status", data.by_status || [], "label", "value", "bar");
		this.render_chart(
			"chart-timeline",
			(data.timeline || []).map((d) => ({
				label: this.format_chart_label(d.date),
				value: d.requests,
			})),
			"label",
			"value",
			"line"
		);
		this.render_chart("chart-item-group", data.by_item_group || [], "label", "value", "bar");
		this.render_chart(
			"chart-fixed-asset-timeline",
			(data.fixed_asset_items_timeline || []).map((d) => ({
				label: this.format_chart_label(d.date),
				value: d.value,
			})),
			"label",
			"value",
			"line"
		);
		this.render_chart(
			"chart-asset-code-timeline",
			(data.asset_codes_timeline || []).map((d) => ({
				label: this.format_chart_label(d.date),
				value: d.value,
			})),
			"label",
			"value",
			"line"
		);

		this.render_table(".iga-table-requested-by", data.by_requested_by || [], [
			{ key: "label", label: __("User") },
			{ key: "requests", label: __("Requests") },
			{ key: "items_requested", label: __("Items Requested") },
			{ key: "items_created", label: __("Codes Created") },
		]);
		this.render_table(".iga-table-cost-center", data.by_cost_center || [], [
			{ key: "label", label: __("Cost Center") },
			{ key: "requests", label: __("Requests") },
			{ key: "items_requested", label: __("Items Requested") },
			{ key: "items_created", label: __("Codes Created") },
		]);
		this.render_table(".iga-table-company", data.by_company || [], [
			{ key: "label", label: __("Company") },
			{ key: "requests", label: __("Requests") },
			{ key: "items_requested", label: __("Items Requested") },
			{ key: "items_created", label: __("Codes Created") },
		]);
	}

	render_chart(element_id, rows, label_key, value_key, type) {
		const parent = this.wrapper.find(`#${element_id}`)[0];
		if (!parent) return;

		if (this.charts[element_id]) {
			try {
				this.charts[element_id].destroy?.();
			} catch (e) {
				/* ignore */
			}
			this.charts[element_id] = null;
		}

		const labels = rows.map((r) => this.format_chart_label(r[label_key]));
		const values = rows.map((r) => flt(r[value_key]) || 0);

		if (!rows.length || values.every((v) => v === 0)) {
			$(parent).html(`<div class="iga-no-data">${__("No data for current filters")}</div>`);
			return;
		}

		$(parent).empty();
		try {
			this.charts[element_id] = new frappe.Chart(`#${element_id}`, {
				type: type === "line" && labels.length === 1 ? "bar" : type,
				height: 220,
				data: {
					labels,
					datasets: [{ name: __("Count"), values }],
				},
				colors: ["#2490ef", "#38a169", "#ed8936", "#9f7aea", "#e53e3e"],
				axisOptions: { xIsSeries: type === "line" && labels.length > 1 },
			});
		} catch (e) {
			$(parent).html(`<div class="iga-no-data">${__("Chart could not be rendered")}</div>`);
			console.warn("Chart error", element_id, e);
		}
	}

	render_table(selector, rows, columns) {
		const wrap = this.wrapper.find(selector);
		if (!rows.length) {
			wrap.html(`<div class="iga-no-data">${__("No data for current filters")}</div>`);
			return;
		}

		const head = columns.map((c) => `<th>${c.label}</th>`).join("");
		const body = rows
			.map((row) => {
				const cells = columns
					.map((c) => {
						const val = row[c.key];
						const display =
							typeof val === "number"
								? frappe.format(val, { fieldtype: "Int" })
								: frappe.utils.escape_html(String(val ?? ""));
						return `<td>${display}</td>`;
					})
					.join("");
				return `<tr>${cells}</tr>`;
			})
			.join("");

		wrap.html(`<table class="iga-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`);
	}
}

function cint(v) {
	return parseInt(v, 10) || 0;
}

function flt(v) {
	return parseFloat(v) || 0;
}
