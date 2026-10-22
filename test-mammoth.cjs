const mammoth = require("mammoth");

mammoth.convertToHtml({path: "test.docx"}, {
    transformDocument: function(element) {
        console.log(JSON.stringify(element, null, 2));
        return element;
    }
}).then(function(result) {
    console.log(result.value);
}).catch(console.error);
