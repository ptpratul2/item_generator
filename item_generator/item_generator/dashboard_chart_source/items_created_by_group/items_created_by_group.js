frappe.provide("frappe.dashboards.chart_sources");

frappe.dashboards.chart_sources["Items Created by Group"] = {
	method:
		"item_generator.item_generator.dashboard_chart_source.items_created_by_group.items_created_by_group.get_data",
	filters: [
		{
			fieldname: "company",
			label: __("Company"),
			fieldtype: "Link",
			options: "Company",
		},
		{
			fieldname: "cost_center",
			label: __("Cost Center"),
			fieldtype: "Link",
			options: "Cost Center",
		},
	],
};
