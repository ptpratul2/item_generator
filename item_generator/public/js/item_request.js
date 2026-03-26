frappe.ui.form.on('Item Code Request', {
    refresh: function(frm) {
        $(frm.fields_dict['items'].grid.wrapper).on('focusin', 'input[data-fieldname="item_name"], textarea[data-fieldname="description"]', function(e) {
            var $input = $(this);
            var fieldname = $input.attr('data-fieldname');
            var grid_row = $input.closest('.grid-row').data('grid_row');

            if ($input.data('awesomplete-init')) return;
            $input.attr('autocomplete', 'off');

            var awesomplete = new Awesomplete(this, {
                minChars: 2,
                maxItems: 10,
                autoFirst: false,
                item: function(text, input) {
                    let parts = text.value.split('|').map(p => p.trim());
                    let code = parts[0] || "";
                    let name = parts[1] || "";
                    let desc = parts[2] || "";

                    // Agar name hai aur code se alag hai, toh "CODE - NAME" dikhao
                    // Warna sirf "CODE" dikhao
                    let display_title = (name && name !== code) ? `${code} - ${name}` : code;
                    
                    let html = `
                        <li style="border-bottom: 1px solid #f0f0f0; padding: 10px; cursor: pointer; list-style: none; background: white; width: 100%;">
                            <div style="color: #167af6; font-weight: bold; font-size: 13px;">${display_title}</div>
                            ${desc ? `<div style="font-size: 11px; color: #666; font-style: italic; white-space: normal;">${desc}</div>` : ''}
                        </li>`;
                    return $(html)[0];
                }
            });

            const updatePosition = () => {
                var rect = $input[0].getBoundingClientRect();
                $(awesomplete.ul).css({
                    "position": "fixed",
                    "top": (rect.bottom) + "px",
                    "left": (rect.left) + "px",
                    "width": rect.width + "px",
                    "z-index": "999999",
                    "background": "white",
                    "box-shadow": "0px 10px 20px rgba(0,0,0,0.2)",
                    "border": "1px solid #ddd",
                    "max-height": "200px",
                    "overflow-y": "auto",
                    "display": "block"
                });
            };

            $input.on('input', function() {
                var val = this.value;
                if (val.length < 2) return;
                frappe.call({
                    method: "item_generator.item_generator.validate_code.get_item_suggestions",
                    args: { txt: val },
                    callback: function(r) {
                        if (r.message) {
                            awesomplete.list = r.message;
                            updatePosition();
                        }
                    }
                });
            });

            this.addEventListener("awesomplete-selectcomplete", function(e) {
                var parts = e.text.value.split('|').map(p => p.trim());
                var item_code = parts[0] || "";
                var item_name = parts[1] || item_code; // Agar name empty hai toh code hi name hai
                var item_desc = parts[2] || "";

                if (fieldname === 'item_name') {
                    frappe.model.set_value(grid_row.doc.doctype, grid_row.doc.name, 'item_name', item_name);
                } else {
                    frappe.model.set_value(grid_row.doc.doctype, grid_row.doc.name, 'description', item_desc);
                }

                if (item_code) {
                    window.open(frappe.utils.get_form_link('Item', item_code), '_blank');
                }
            });

            $(window).on('scroll.awesomplete resize.awesomplete', function() {
                $(awesomplete.ul).hide();
            });

            $input.data('awesomplete-init', true);
        });
    },
});