var mongoose = require('mongoose');
var mongoosePaginate = require('mongoose-paginate');

var Schema = mongoose.Schema;

var ProductSchema = new Schema({
    
    vendor_id:          {type: Schema.Types.ObjectId, required: true},
    category:           {type: String, default: null},
    name:               {type: String, default: null},
    description:        {type: String, default: null},
    price:              {type: Number, default: 0.0},
    image:              {type: String, default: null},
    gallery:            {type: [String], default: []},
    featured:           {type: Boolean, default: false},
    enabled:            {type: Boolean, default: true},
    sale:               {type: String, default: null},
    keywords:           {type: [String], default: []}
    
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

ProductSchema.plugin(mongoosePaginate);

Product = mongoose.model('Product', ProductSchema);

module.exports = Product;