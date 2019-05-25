var mongoose = require('mongoose');
var mongoosePaginate = require('mongoose-paginate');

var Schema = mongoose.Schema;

var RequestSchema = new Schema({
        
    vendor_id:          {type: Schema.Types.ObjectId, required: true},
    product:            {type: Schema.Types.ObjectId, ref: 'Product', required: true},
    name:               {type: String, default: null},
    email:              {type: String, default: null},
    phone:              {type: String, default: null},
    notes:              {type: String, default: null},
    status:             {type: String, enum: ['pending', 'solved', 'rejected', 'workout'], default: 'pending'},
    
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

RequestSchema.plugin(mongoosePaginate);

Request = mongoose.model('Request', RequestSchema);

module.exports = Request;