var mongoose = require('mongoose');
var bcrypt = require('bcrypt');
var SALT_WORK_FACTOR = 10;

var mongoosePaginate = require('mongoose-paginate');

var Schema = mongoose.Schema;

var VendorSchema = new Schema({
        
    account: {
        username:               {type: String, required:true},
        password:               {type: String, required:true},
        role:                   {type: String, enum: ['admin', 'user'], default: 'user'},
    },
    
    contact: {
        name:                   {type: String, default: null},
        lastname:               {type: String, default: null},
        shopname:               {type: String, default: null},
        address:                {type: String, default: null},
        phone:                  {type: String, default: null},
        city:                   {type: String, default: null},
        state:                  {type: String, default: null},
        country:                {type: String, default: null},
        postcode:               {type: String, default: null},
        email:                  {type: String, default: null, lowercase: true},
        site:                   {type: String, default: null, lowercase: true}
    },
    
    announcements: [{ type: Schema.Types.ObjectId, ref: 'Announcement', default: null }],
    
    products: [{ type: Schema.Types.ObjectId, ref: 'Product', default: null }],
    
    requests: [{ type: Schema.Types.ObjectId, ref: 'Request', default: null }]
    
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// mongoose middleware to automatically hash a password when the user is saved,
// this middleware is not invoked on update() operations, so we must use a 
// save() if we want to update user passwords
VendorSchema.pre('save', function(next) {
        
    var vendor = this;
    
    // only hash the password if it has been modified (or is new)
    if ( (!vendor.isModified('account.password')) && !vendor.isNew ) {
        return next();
    }

    // generate a salt
    bcrypt.genSalt(SALT_WORK_FACTOR, function(err, salt) {
        if (err) return next(err);

        // hash the password along with our new salt
        bcrypt.hash(vendor.account.password, salt, function(err, hash) {
            if (err) return next(err);

            // override the cleartext password with the hashed one
            vendor.account.password = hash;
            next();
        });
    });
});

// attach to the model a password verification method
VendorSchema.methods.comparePassword = function(candidatePassword, cb) {
    bcrypt.compare(candidatePassword, this.account.password, function(err, isMatch) {
        if (err) return cb(err);
        cb(null, isMatch);
    });
};

// attach to the model an access permission
VendorSchema.methods.applyPermission = function(accessorRole) {
    
    var vendor = this;

    if (accessorRole == 'user') {
        // user is accessing
    
        // hide fields from user
        vendor.account = {
            'username': vendor.account.username,
            'password': vendor.account.password
        }
        
    }
    else {
        // admin is accessing
        
    }
    
    return vendor;
  
}

VendorSchema.plugin(mongoosePaginate);

Vendor = mongoose.model('Vendor', VendorSchema);

module.exports = Vendor;