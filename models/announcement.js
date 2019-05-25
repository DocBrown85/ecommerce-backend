var mongoose = require('mongoose');
var mongoosePaginate = require('mongoose-paginate');

var Schema = mongoose.Schema;
    
var AnnouncementSchema = new Schema({
        
    vendor_id:          {type: Schema.Types.ObjectId, required: true},
    announcement_text:  {type: String, required: true},
    image:              {type: String, default: null},
    featured:           {type: Boolean, default: false},
    
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

AnnouncementSchema.plugin(mongoosePaginate);

Announcement = mongoose.model('Announcement', AnnouncementSchema);

module.exports = Announcement;