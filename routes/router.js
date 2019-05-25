// routes/router.js

// =============================================================================
// Import App Configurations
// =============================================================================
var config              = require('../config');

// =============================================================================
// Import Packages
// =============================================================================
var util                = require('util');
var express             = require('express');
var _                   = require('underscore');

// used to enable CORS requests TODO: REMOVE if not necessary
var cors                = require('cors');

// used for handling and transforming file paths
var path                = require("path");

// used to handle file system's facilities (Node.js native)
var fs                  = require('fs');

// used to handle file system's facilities
// (superseeds Node.js native, but we keep both for clarity)
var fse                 = require('fs-extra');

// used to create, sign, and verify tokens
var jwt                 = require('jsonwebtoken');

// used to handle form's multipart/form-data
var multer              = require('multer');
// setup Multer DiskStorage to handle dynamic destination directories
var storage             = multer.diskStorage({
        
    // used to dynamically change destination directory for uploaded files
    destination: function (req, file, cb) {
        
        var vendor_file_upload_items_dir;
        var item_dir;
        if (req.route.path.indexOf('products') >= 0) {
            vendor_file_upload_items_dir = 'products';
            item_dir = req.params.product_id;
        }
        else if (req.route.path.indexOf('announcements') >= 0) {
            vendor_file_upload_items_dir = 'announcements';
            item_dir = req.params.announcement_id;
        }
        else {
            throw new Error('cannot upload files on this route');
        }
        
        var dest = config.upload_root_dir
                    + '/'
                    + req.params.vendor_id
                    + '/'
                    + vendor_file_upload_items_dir
                    + '/'
                    + item_dir;
                    
        cb(null, dest);
        
    },
    
    // used to dynamically change filename for uploaded files
    filename: function (req, file, cb) {
        
        var file_name;
        if (req.route.path.indexOf('products') >= 0
            && req.route.path.indexOf('gallery') >= 0) {
            // we are receiving an image for product's gallery
            
            file_name = 'gallery-image-' + file.originalname;
        }
        else {
            // leave original file name for other cases
            file_name = file.originalname; 
        }
        
        cb(null, file_name);
        
    }
    
});
var multer_upload       = multer({

    storage: storage,
    
    fileFilter: function (req, file, cb) {
        
        var filetypes = /jpeg|jpg/;
        var mimetype = filetypes.test(file.mimetype);
        var extname = filetypes.test(path.extname(file.originalname).toLowerCase());

        if (mimetype && extname) {
            // to accept this file pass `true`
            return cb(null, true);
        }
        
        // to silently reject this file pass `false`
        //cb(null, false);
        
        // we can always pass an error to abort the whole upload operation 
        return cb(new Error("invalid file format"));
    },
    
    limits: {
        
        // max field name size (in bytes)
        fieldNameSize: config.upload_max_field_name_size,
        
        // max field value size (in bytes)
        fieldSize: config.upload_max_field_size,
        
        // max number of non-file fields
        fields: config.upload_max_fields,
        
        // for multipart forms, the max file size (in bytes)
        fileSize: config.upload_max_file_size,
        
        // for multipart forms, the max number of file fields
        files: config.upload_max_files_per_request,
        
        // for multipart forms, the max number of parts (fields + files)
        //parts:
        
        // for multipart forms, the max number of header key=>value pairs to parse
        headerPairs: config.upload_max_header_pairs
        
    }

});

// used to handle query params for MongoDb
var qpm                 = require('query-params-mongo');
var qpmOptions          = {};
var queryProcessor      = qpm(qpmOptions);

// used to send e-mails
var nodemailer          = require('nodemailer');
// setup e-mails transport layer
var transporter = nodemailer.createTransport();

// =============================================================================
// Import Models
// =============================================================================
var Product             = require('../models/product.js');
var Announcement        = require('../models/announcement.js');
var Request             = require('../models/request.js');
var Vendor              = require('../models/vendor.js');

// =============================================================================
// Utility Functions
// =============================================================================

// utility function to get a full path relative to a path beginning with it
function getRelativePath(fullPath, pathToStrip) {
    
    var path = _.difference(fullPath.split('/'), pathToStrip.split('/'));
                    
    return path.join('/');
    
}

// utility function to check route permission based on users roles
function requireRole(roles) {
    return function(req, res, next) {
        
        if (_.contains(roles, req.decoded.role)) {
            // role permission is ok, check further if needed
            
            if (req.decoded.role == 'user') {
                // additional checks for user
                
                if (req.params.hasOwnProperty('vendor_id')
                    && req.params.vendor_id == req.decoded.id ) {
                    // user permission are ok
                    next();
                }
                else {
                    // user cannot access API out of his ID path
                    res.status(403).json({ 'message': 'forbidden' });
                }
            
            }
            else {
                // admin and guest are ok here
                next();
            }

        }
        else {
            // role permission not satisfied
            res.status(403).json({ 'message': 'forbidden' });
        }
       
    }
}

// =============================================================================
// ROUTES FOR OUR API
// =============================================================================

// get an instance of the express router
var router              = express.Router();

// middleware to enable CORS requests for the whole API
router.use(cors());

// hook middleware to use for all requests
router.use(function(req, res, next) {
        
    // don't stop here
    next();
    
});

// test route to make sure everything is working
// (accessed at GET http://URL:port/api)
router.get('/', function(req, res) {
    
    var d = new Date();
    res.json({
        time: d.getTime(),
        version: config.version,
    });
    
});

// -----------------------------------------------------------------------------
// AUTHENTICATION ROUTE
// -----------------------------------------------------------------------------
router.post('/authenticate', function (req, res) {
        
    // validate request parameters
        
    // required parameters
    req.checkBody('username', 'invalid username').notEmpty().isAlphanumeric();
    req.checkBody('password', 'invalid password').notEmpty().isAlphanumeric();
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
    
    Vendor.findOne({
            'account.username': req.body.username
    }, function(err, vendor){
        
        if (err) {
            return res.status(500).send(err);
        }
        
        if (!vendor) {
            return res.status(403).json({'message':'wrong username or password'});
        }
        // vendor exists
        
        vendor.comparePassword(req.body.password, function(err, isMatch) {
                
            var payload = {
                id: null,
                role: null
            };
    
            if (err) {
                return res.status(500).send(err);
            }
            
            if (!isMatch) {
                return res.status(403).json({'message':'wrong username or password'});
            }
            
            payload.id = vendor._id;
            payload.role = vendor.account.role;
            
            var token = jwt.sign(payload, config.secret, {
                expiresIn: config.token_expiry_time
            });
        
            return res.json({
                    '_id': vendor._id,
                    'token': token
            });
        
        });
        
    });
        
});

// -----------------------------------------------------------------------------
// middleware to verify tokens
// -----------------------------------------------------------------------------
router.use(function(req, res, next) {
        
    // check header or url parameters or post parameters for token
    var token = req.body.token || req.query.token || req.headers['x-access-token'];
    
    // decode token
    if (token) {
        // token found
        
        // verifies secret and checks exp
        jwt.verify(token, config.secret, function(err, decoded) {      
                
            if (err) {
                return res.status(403).json({ message: 'bad token' });    
            }
                
            // if everything is good, save to request for use in other routes
            req.decoded = decoded;
            
            console.log("got request from:" + decoded.role);
            
            next();
                
        });
    }
    else {
        // no token provided
        
        req.decoded = { role: 'guest' };
        
        console.log("got request from: guest");
        
        next();
    }
        
});

// -----------------------------------------------------------------------------
// ROUTES FOR VENDOR HANDLING
// -----------------------------------------------------------------------------
router.route('/vendor')

// -----------------------------------------------------------------------------
// route for creating a vendor
// -----------------------------------------------------------------------------
.post(requireRole(['admin']), function(req, res) {
        
    // validate request parameters
    
    // required parameters
    req.checkBody('username', 'invalid username').notEmpty().isAlphanumeric();
    req.checkBody('password', 'invalid password').notEmpty().isAlphanumeric();
    req.checkBody('role', 'invalid role').notEmpty().isIn(['admin', 'user']);
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
    
    // check we are creating a unique vendor username
    Vendor.count({
            'account.username': req.body.username
    }, function(err, count) {
        
        if (err) {
            return res.send(err);
        }
        
        if (count > 0) {
            return res.status(400).send({ 'message': 'username already exists' });
        }
        
        var vendor = new Vendor();
        
        vendor.account = req.body;

        vendor.save(function(err, vendor) {
        
            if (err) {
                res.status(500).send({ 'message' : err });
                return;
            }
            
            // create upload directories for this vendor
            // WARN: trust MongoDb will give us unique identifiers
            try {
                
                var vendor_file_upload_root = config.upload_root_dir
                    + '/'
                    + vendor._id;
                    
                fse.mkdirsSync(
                    vendor_file_upload_root
                    + '/'
                    + 'products');
                
                fse.mkdirsSync(
                    vendor_file_upload_root
                    + '/'
                    + 'announcements');
                
            }
            catch (error) {
                res.status(500).send({ 'message' : error.message });
                return;
            }

            return res.send({ '_id': vendor._id });
        });
    
    });

})
    
// -----------------------------------------------------------------------------
// route for getting all vendors
// -----------------------------------------------------------------------------
.get(requireRole(['admin']), function(req, res) {
        
    // parse query string parameters
    var fieldSpec = {
        //{name: {dataType: 'string', required: false}},
    };
    var useStrict = false;
    try {
        var cliQuery = queryProcessor(req.query, fieldSpec, useStrict);
    } catch (errors) {
        res.status(500).send(errors.message);
        return;
    }
    
    // find vendors
    var query = _.extend(cliQuery.filter,
        {}
    );
    var options = {
        sort: cliQuery.sort,
        limit: cliQuery.limit,
        offset: cliQuery.offset
    };
    Vendor.paginate(query, options, function(err, vendors) {
            
        if (err) {
            res.status(500).send({ 'message' : err });
            return;
        }
        
        res.json(vendors);
                
    });
        
});

// -----------------------------------------------------------------------------
// ROUTES FOR HANDLING SPECIFIED VENDOR
// -----------------------------------------------------------------------------
router.route('/vendor/:vendor_id')

// -----------------------------------------------------------------------------
// route for getting specified vendor
// -----------------------------------------------------------------------------
.get(requireRole(['admin', 'user']), function(req, res) {
        
    // validate request parameters

    // required parameters
    req.checkParams('vendor_id', 'invalid vendor').notEmpty().isMongoId();
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
    
    Vendor.findById(req.params.vendor_id, function(err, vendor) {
            
        if (err) {
            res.status(500).send({ 'message' : err });
            return;
        }
        
        if (!vendor) {
            res.status(404).send({ 'message' : 'vendor not found' });
            return;
        }
        
        //res.send(vendor);
        res.send(vendor.applyPermission(req.decoded.role));
        
    });
        
})

// -----------------------------------------------------------------------------
// route for deleting specified vendor
// -----------------------------------------------------------------------------
.delete(requireRole(['admin']), function(req, res) {
        
    // validate request parameters

    // required parameters
    req.checkParams('vendor_id', 'invalid vendor').notEmpty().isMongoId();
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
    
    Vendor.findByIdAndRemove(req.params.vendor_id, function(err, vendor) {
            
        if (err) {
            res.status(500).send({ 'message' : err });
            return;
        }
        
        if (!vendor) {
            res.status(404).send({ 'message' : 'vendor not found' });
            return;
        }
        
        // remove upload directories for this vendor
        try {
            
            var vendor_file_upload_root = config.upload_root_dir
                + '/'
                + vendor._id;
                
            fse.removeSync(vendor_file_upload_root);
            
        }
        catch (error) {
            res.status(500).send({ 'message' : error.message });
            return;
        }
        
        res.json({ 'message': 'vendor deleted'});
        
    });

});

// -----------------------------------------------------------------------------
// ROUTES FOR HANDLING VENDOR'S ACCOUNT
// -----------------------------------------------------------------------------
router.route('/vendor/:vendor_id/account')

// -----------------------------------------------------------------------------
// route for getting vendor account
// -----------------------------------------------------------------------------
.get(requireRole(['admin', 'user']), function(req, res) {
        
    // validate request parameters
        
    // required parameters
    req.checkParams('vendor_id', 'invalid vendor').notEmpty().isMongoId();
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
            
    Vendor.findById(req.params.vendor_id, function(err, vendor) {
            
        if (err) {
            res.status(500).send({ 'message' : err });
            return;
        }
        
        if (!vendor) {
            res.status(404).send({ 'message' : 'vendor not found' });
            return;
        }
        // vendor exists
        
        vendor = vendor.applyPermission(req.decoded.role);
        
        // return this vendor's account info
        res.json( vendor.account );
        
    });     
            
})

// -----------------------------------------------------------------------------
// route for updating vendor account
// -----------------------------------------------------------------------------
.put(requireRole(['admin', 'user']), function(req, res) {
        
    // validate request parameters
        
    // required parameters
    req.checkParams('vendor_id', 'invalid vendor').notEmpty().isMongoId();
    req.checkBody('password', 'invalid password').notEmpty().isAlphanumeric();
    req.checkBody('role', 'invalid role').optional().notEmpty().isAlpha();
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
            
    Vendor.findById(req.params.vendor_id, function(err, vendor) {
            
        if (err) {
            res.status(500).send({ 'message' : err });
            return;
        }
        
        if (!vendor) {
            res.status(404).send({ 'message' : 'vendor not found' });
            return;
        }
        
        // update vendor account
        //vendor.account.username = req.body.username; NOT ALLOWED
        vendor.account.password = req.body.password;
        if (req.decoded.role == 'admin' && (req.body.hasOwnProperty('role')) ) {
            vendor.account.role = req.body.role;
        }
        
        // save operation here is required! otherwise mongoose middleware for
        // password hashing would not be called!
        vendor.save(function(err, vendor) {
                
            if (err) {
                res.status(500).send({ 'message' : err });
                return;
            }
            
            res.json({ 'message': 'account updated'});
                
        });
        
    });     
            
});

// -----------------------------------------------------------------------------
// ROUTES FOR HANDLING VENDOR'S CONTACT
// -----------------------------------------------------------------------------
router.route('/vendor/:vendor_id/contact')

// -----------------------------------------------------------------------------
// route for getting vendor contact
// -----------------------------------------------------------------------------
.get(requireRole(['admin', 'user', 'guest']), function(req, res) {
        
    // validate request parameters
        
    // required parameters
    req.checkParams('vendor_id', 'invalid vendor').notEmpty().isMongoId();
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
            
    Vendor.findById(req.params.vendor_id, function(err, vendor) {
            
        if (err) {
            res.status(500).send({ 'message' : err });
            return;
        }
        
        if (!vendor) {
            res.status(404).send({ 'message' : 'vendor not found' });
            return;
        }
        // vendor exists
        
        // return this vendor's contact
        res.json( vendor.contact );
        
    });     
            
})
     
// -----------------------------------------------------------------------------
// route for updating vendor contact
// -----------------------------------------------------------------------------
.put(requireRole(['admin', 'user']), function(req, res) {
        
    // validate request parameters
        
    // required parameters
    req.checkParams('vendor_id', 'invalid vendor').notEmpty().isMongoId();
    req.checkBody('name', 'invalid contact name').notEmpty().isAscii();
    req.checkBody('lastname', 'invalid contact lastname').notEmpty().isAscii();
    req.checkBody('shopname', 'invalid contact shopname').notEmpty().isAscii();
    req.checkBody('address', 'invalid contact address').notEmpty().isAscii();
    req.checkBody('phone', 'invalid contact phone').notEmpty().isNumeric();
    req.checkBody('city', 'invalid contact city').notEmpty().isAscii();
    req.checkBody('state', 'invalid contact state').notEmpty().isAlpha();
    req.checkBody('country', 'invalid contact country').notEmpty().isAscii();
    req.checkBody('postcode', 'invalid contact postcode').notEmpty().isNumeric();
    // optional parameters
    req.checkBody('email', 'invalid contact email').optional().notEmpty().isEmail();
    req.checkBody('site', 'invalid contact site').optional().notEmpty().isURL();
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
            
    Vendor.findById(req.params.vendor_id, function(err, vendor) {
            
        if (err) {
            res.status(500).send({ 'message' : err });
            return;
        }
        
        if (!vendor) {
            res.status(404).send({ 'message' : 'vendor not found' });
            return;
        }
        
        // update vendor contact
        vendor.contact = req.body;
        vendor.save(function(err, vendor) {
                
            if (err) {
                res.status(500).send({ 'message' : err });
                return;
            }
            
            res.json({ 'message': 'contact updated'});
            
        });
        
    });     
            
});

// -----------------------------------------------------------------------------
// ROUTES FOR PRODUCT HANDLING
// -----------------------------------------------------------------------------
router.route('/vendor/:vendor_id/products')
 
// -----------------------------------------------------------------------------
// route for getting all products
// -----------------------------------------------------------------------------
.get(requireRole(['admin', 'user', 'guest']), function(req, res) {
    
    // validate request parameters
    
    // required parameters
    req.checkParams('vendor_id', 'invalid vendor').notEmpty().isMongoId();
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
    
    // parse query string parameters
    var fieldSpec = {
        //{name: {dataType: 'string', required: false}},
    };
    var useStrict = false;
    try {
        var cliQuery = queryProcessor(req.query, fieldSpec, useStrict);
    } catch (errors) {
        res.status(400).send(errors.message);
        return;
    }
    
    // find specified vendor
    Vendor.findById(req.params.vendor_id, function(err, vendor) {
            
        if (err) {
            res.status(500).send({ 'message' : err });
            return;
        }
        
        if (!vendor) {
            res.status(404).send({ 'message' : 'vendor not found' });
            return;
        }
        // vendor exists
        
        // find vendor's products
        var query = _.extend(cliQuery.filter,
            {'vendor_id' : vendor._id}
        );
        var options = {
            sort: cliQuery.sort,
            limit: cliQuery.limit,
            offset: cliQuery.offset
        };
        Product.paginate(query, options, function(err, products) {
                
            if (err) {
                res.status(500).send({ 'message' : err });
                return;
            }
            
            // products
            res.json( products );
            
        });
        
    });

})

// -----------------------------------------------------------------------------
// route for creating new product
// -----------------------------------------------------------------------------
.post(requireRole(['admin', 'user']), function(req, res) {
    
    // validate request parameters
    
    // required parameters
    req.checkParams('vendor_id', 'invalid vendor').notEmpty().isMongoId();
    req.checkBody('category', 'invalid category').notEmpty().isAscii();
    req.checkBody('name', 'invalid contact name').notEmpty().isAscii();
    req.checkBody('description', 'invalid description').notEmpty().isAscii();
    req.checkBody('price', 'invalid price').notEmpty().isFloat();
    
    // optional parameters
    req.checkBody('featured', 'invalid featured').optional().notEmpty().isBoolean();
    req.checkBody('enabled', 'invalid enabled').optional().notEmpty().isBoolean();
    req.checkBody('sale', 'invalid sale').optional().notEmpty();
    req.checkBody('keywords', 'invalid keywords').optional().notEmpty();
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
    
    // find specified vendor
    Vendor.findById(req.params.vendor_id, function(err, vendor) {
            
        if (err) {
            res.status(500).send({ 'message' : err });
            return;
        }
        
        if (!vendor) {
            res.status(404).send({ 'message' : 'vendor not found' });
            return;
        }
        // vendor exists
        
        // check if this product is unique for this vendor - todo
        
        // insert the new product
        var product = new Product();
        for(var param in req.body) {
            product[param] = req.body[param];
        }
        product.vendor_id = req.params.vendor_id;
        
        // save
        product.save(function(err, product) {
            
            if (err) {
                res.status(500).send({ 'message' : err });
                return;
            }
            // product save ok
            
            // save this product in vendor's products ids
            vendor.products.push(product._id);
            vendor.save(function(err, vendor) {
                
                if (err) {
                    res.status(500).send({ 'message' : err });
                    return;
                }
                
                // create upload directory for this product
                // WARN: trust MongoDb will give us unique identifiers
                try {
                    
                    var file_upload_root = config.upload_root_dir
                        + '/'
                        + req.params.vendor_id
                        + '/'
                        + 'products';
                        
                    fse.mkdirsSync(
                        file_upload_root
                        + '/'
                        + product._id);
                    
                }
                catch (error) {
                    res.status(500).send({ 'message' : error.message });
                    return;
                }
                
                // return new product's id
                res.json( {'_id':product._id} );
                
                return;
            });
            
        });
        
    });

})

// -----------------------------------------------------------------------------
// route for deleting all products for specified vendor
// -----------------------------------------------------------------------------
.delete(requireRole(['admin', 'user']), function(req, res) {
    
    // validate request parameters
    
    // required parameters
    req.checkParams('vendor_id', 'invalid vendor').notEmpty().isMongoId();
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
    
    // find specified vendor
    Vendor.findById(req.params.vendor_id, function(err, vendor) {
            
        if (err) {
            res.status(500).send({ 'message' : err });
            return;
        }
        
        if (!vendor) {
            res.status(404).send({ 'message' : 'vendor not found' });
            return;
        }
        // vendor exists
        
        // clean products
        Product.remove({'vendor_id':vendor._id}, function(err) {
                
            if (err) {
                res.status(500).send({ 'message' : err });
                return;
            }
            
            // clean vendor
            vendor.products = [];
            vendor.save(function(err, vendor) {
            
                if (err) {
                    res.status(500).send({ 'message' : err });
                    return;
                }
                
                // cleanup upload directory for this vendor's products
                try {
                    
                    var file_upload_root = config.upload_root_dir
                        + '/'
                        + req.params.vendor_id
                        + '/'
                        + 'products';
                        
                    fse.removeSync(file_upload_root);
                    
                    fse.mkdirsSync(file_upload_root);
                    
                }
                catch (error) {
                    res.status(500).send({ 'message' : error.message });
                    return;
                }
                
                // done
                res.json({ 'message' : 'products empty' });
                
                return;
                
            });
                
        });
        
    });
    
});

// -----------------------------------------------------------------------------
// ROUTES FOR HANDLING SPECIFIC PRODUCT
// -----------------------------------------------------------------------------
router.route('/vendor/:vendor_id/products/:product_id')

// -----------------------------------------------------------------------------
// route for getting specified product from specified vendor
// -----------------------------------------------------------------------------
.get(requireRole(['admin', 'user', 'guest']), function(req, res) {
        
    // validate request parameters
    
    // required parameters
    req.checkParams('vendor_id', 'invalid vendor').notEmpty().isMongoId();
    req.checkParams('product_id', 'invalid product').notEmpty().isMongoId();
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
    
    // find specified vendor
    Vendor.findById(req.params.vendor_id, function(err, vendor) {
    
        if (err) {
            res.status(500).send({ 'message' : err });
            return;
        }
        
        if (!vendor) {
            res.status(404).send({ 'message' : 'vendor not found' });
            return;
        }
        // vendor exists
        
        // find specified product
        Product.findById(req.params.product_id, function(err, product) {
    
            if (err) {
                res.status(500).send({ 'message' : err });
                return;
            }
            
            if (!product) {
                res.status(404).send({ 'message' : 'product not found' });
                return;
            }
            // product exists
            
            // return it
            res.json(product);
            
        });
        
    });
})

// -----------------------------------------------------------------------------
// route for updating specified product for specified vendor
// -----------------------------------------------------------------------------
.put(requireRole(['admin', 'user']), function(req, res) {
    // validate request parameters
    
    // required parameters
    req.checkParams('vendor_id', 'invalid vendor').notEmpty().isMongoId();
    req.checkParams('product_id', 'invalid vendor').notEmpty().isMongoId();
    req.checkBody('category', 'invalid category').notEmpty().isAscii();
    req.checkBody('name', 'invalid contact name').notEmpty().isAscii();
    req.checkBody('description', 'invalid description').notEmpty().isAscii();
    req.checkBody('price', 'invalid price').notEmpty().isFloat();
    
    // optional parameters
    req.checkBody('featured', 'invalid featured').optional().notEmpty().isBoolean();
    req.checkBody('enabled', 'invalid enabled').optional().notEmpty().isBoolean();
    req.checkBody('sale', 'invalid sale').optional().notEmpty();
    req.checkBody('keywords', 'invalid keywords').optional().notEmpty();
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
    
    // strip keys we do not want to handle here
    req.body = _.omit(req.body, ['_id', 'vendor_id', 'image', 'gallery']);
    
    // find specified vendor
    Vendor.findById(req.params.vendor_id, function(err, vendor) {
            
        if (err) {
            res.status(500).send({ 'message' : err });
            return;
        }
        
        if (!vendor) {
            res.status(404).send({ 'message' : 'vendor not found' });
            return;
        }
        // vendor exists
        
        // find specified product
        Product.findById(req.params.product_id, function(err, product) {
    
            if (err) {
                res.status(500).send({ 'message' : err });
                return;
            }
            
            if (!product) {
                res.status(404).send({ 'message' : 'product not found' });
                return;
            }
            // product exists
            
            // update it
            for(var param in req.body) {
                product[param] = req.body[param];
            }
            
            // save it
            product.save(function(err, product) {
                
                if (err) {
                    res.status(500).send({ 'message' : err });
                    return;
                }
                // product save ok
                
                res.send({ 'message' : 'product updated' });
                return;

            });
            
        });
        
    });
    
})

// -----------------------------------------------------------------------------
// route for deleting specified product from specified vendor
// -----------------------------------------------------------------------------
.delete(requireRole(['admin', 'user']), function(req, res) {
        
    // validate request parameters
    
    // required parameters
    req.checkParams('vendor_id', 'invalid vendor').notEmpty().isMongoId();
    req.checkParams('product_id', 'invalid product').notEmpty().isMongoId();
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
    
    // find specified vendor
    Vendor.findById(req.params.vendor_id, function(err, vendor) {
    
        if (err) {
            res.status(500).send({ 'message' : err });
            return;
        }
        
        if (!vendor) {
            res.status(404).send({ 'message' : 'vendor not found' });
            return;
        }
        // vendor exists
        
        // remove product
        Product.remove({
            '_id' : req.params.product_id,
            'vendor_id':vendor._id
        }, function(err) {
            
            if (err) {
                res.status(500).send({ 'message' : err });
                return;
            }
            
            // remove product id from vendor
            vendor.products = _.reject(vendor.products, function(p_id) {
                    return p_id == req.params.product_id 
            });
            
            // save vendor
            vendor.save(function(err, vendor) {
                
                if (err) {
                    res.status(500).send({ 'message' : err });
                    return;
                }
                
                try {
                
                    var file_upload_root = config.upload_root_dir
                        + '/'
                        + req.params.vendor_id
                        + '/'
                        + 'products';
                        
                    fse.removeSync(file_upload_root
                        + '/'
                        + req.params.product_id);
                
                }
                catch (error) {
                    res.status(500).send({ 'message' : error.message });
                    return;
                }
                
                res.send({ 'message' : 'product deleted' });
                return;
            });
            
        });
        
    });
        
});
    
// -----------------------------------------------------------------------------
// ROUTES FOR HANDLING SPECIFIED PRODUCT'S WALLPAPER IMAGE
// -----------------------------------------------------------------------------
router.route('/vendor/:vendor_id/products/:product_id/image')

// -----------------------------------------------------------------------------
// route for setting specified product's wallpaper image
// -----------------------------------------------------------------------------
.post(requireRole(['admin', 'user']), function(req, res) {
    
    // validate request parameters
    
    // required parameters
    req.checkParams('vendor_id', 'invalid vendor').notEmpty().isMongoId();
    req.checkParams('product_id', 'invalid vendor').notEmpty().isMongoId();
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
    
    // find specified vendor
    Vendor.findById(req.params.vendor_id, function(err, vendor) {
            
        if (err) {
            res.status(500).send({ 'message' : err });
            return;
        }
        
        if (!vendor) {
            res.status(404).send({ 'message' : 'vendor not found' });
            return;
        }
        // vendor exists
        
        // find specified product
        Product.findById(req.params.product_id, function(err, product) {
    
            if (err) {
                res.status(500).send({ 'message' : err });
                return;
            }
            
            if (!product) {
                res.status(404).send({ 'message' : 'product not found' });
                return;
            }
            // product exists
            
            // remove the previous product image, if any
            if (product.image) {
                
                try {
                    fse.removeSync(config.file_server_root + '/' + product.image);
                }
                catch (error) {
                    res.status(500).send({ 'message' : error.message });
                    return;
                }
                
            }
            
            // proceed with upload
            var do_upload = multer_upload.single('product_image');
            do_upload(req, res, function(err) {
                    
                // WARN: err is the multer-specific error format
                
                if (err) {
                    res.status(500).send({ 
                        'message' : err.name + ':' + err.message
                    });
                    return;
                }
                // upload success
                
                // save the new product image URL
                product.image = getRelativePath(req.file.path, config.file_server_root);
                product.save(function(err, product) {
            
                        if (err) {
                            res.status(500).send({ 'message' : err });
                            return;
                        }
                        // product save ok
            
                        res.send({ 'message' : 'product image saved' });
                        return;

                });
            
            });
            
        });
        
    });
    
})

// -----------------------------------------------------------------------------
// route for deleting specified product's wallpaper image
// -----------------------------------------------------------------------------
.delete(requireRole(['admin', 'user']), function(req, res) {
        
    // validate request parameters
    
    // required parameters
    req.checkParams('vendor_id', 'invalid vendor').notEmpty().isMongoId();
    req.checkParams('product_id', 'invalid vendor').notEmpty().isMongoId();
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
    
    // find specified vendor
    Vendor.findById(req.params.vendor_id, function(err, vendor) {
            
        if (err) {
            res.status(500).send({ 'message' : err });
            return;
        }
        
        if (!vendor) {
            res.status(404).send({ 'message' : 'vendor not found' });
            return;
        }
        // vendor exists
        
        // find specified product
        Product.findById(req.params.product_id, function(err, product) {
    
            if (err) {
                res.status(500).send({ 'message' : err });
                return;
            }
            
            if (!product) {
                res.status(404).send({ 'message' : 'product not found' });
                return;
            }
            // product exists
            
            // remove the previous product image, if any
            if (product.image) {
                
                try {
                    fse.removeSync(config.file_server_root + '/' + product.image);
                }
                catch (error) {
                    res.status(500).send({ 'message' : error.message });
                    return;
                }
                
            }
            
            // cleanup product image URL
            product.image = null;
            product.save(function(err, product) {
        
                if (err) {
                    res.status(500).send({ 'message' : err });
                    return;
                }
                // product save ok
    
                res.send({ 'message' : 'product image deleted' });
                return;

            });
            
        });
        
    });
    
});

// -----------------------------------------------------------------------------
// ROUTES FOR HANDLING SPECIFIED PRODUCT'S IMAGE GALLERY
// -----------------------------------------------------------------------------
router.route('/vendor/:vendor_id/products/:product_id/gallery')

// -----------------------------------------------------------------------------
// route for setting specified product's gallery image (order matters)
// -----------------------------------------------------------------------------
.post(requireRole(['admin', 'user']), function(req, res) {
        
    // validate request parameters
    
    // required parameters
    req.checkParams('vendor_id', 'invalid vendor').notEmpty().isMongoId();
    req.checkParams('product_id', 'invalid vendor').notEmpty().isMongoId();
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
    
    // find specified vendor
    Vendor.findById(req.params.vendor_id, function(err, vendor) {
            
        if (err) {
            res.status(500).send({ 'message' : err });
            return;
        }
        
        if (!vendor) {
            res.status(404).send({ 'message' : 'vendor not found' });
            return;
        }
        // vendor exists
        
        // find specified product
        Product.findById(req.params.product_id, function(err, product) {
    
            if (err) {
                res.status(500).send({ 'message' : err });
                return;
            }
            
            if (!product) {
                res.status(404).send({ 'message' : 'product not found' });
                return;
            }
            // product exists
            
            // check we have room left for a new gallery image
            if (_.size(product.gallery) >= config.max_product_image_gallery_size ) {
                
                res.status(403).send({ 'message' : 'no room left for gallery images' });
                return;
                
            }
            // we have enough room
            
            // proceed with upload
            var do_upload = multer_upload.single('product_gallery_image');
            do_upload(req, res, function(err) {
                    
                // WARN: err is the multer-specific error format
                
                if (err) {
                    res.status(500).send({ 
                        'message' : err.name + ':' + err.message
                    });
                    return;
                }
                // upload success
                
                // save the new product image gallery URL
                product.gallery.push(getRelativePath(req.file.path, config.file_server_root));
                product.save(function(err, product) {
            
                        if (err) {
                            res.status(500).send({ 'message' : err });
                            return;
                        }
                        // product save ok
            
                        res.send({ 'message' : 'product gallery image saved' });
                        return;

                });
            
            });
            
        });
        
    });
    
})

// -----------------------------------------------------------------------------
// route for deleting specified product's image gallery
// -----------------------------------------------------------------------------
.delete(requireRole(['admin', 'user']), function(req, res) {
        
    // validate request parameters
    
    // required parameters
    req.checkParams('vendor_id', 'invalid vendor').notEmpty().isMongoId();
    req.checkParams('product_id', 'invalid vendor').notEmpty().isMongoId();
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
    
    // find specified vendor
    Vendor.findById(req.params.vendor_id, function(err, vendor) {
            
        if (err) {
            res.status(500).send({ 'message' : err });
            return;
        }
        
        if (!vendor) {
            res.status(404).send({ 'message' : 'vendor not found' });
            return;
        }
        // vendor exists
        
        // find specified product
        Product.findById(req.params.product_id, function(err, product) {
    
            if (err) {
                res.status(500).send({ 'message' : err });
                return;
            }
            
            if (!product) {
                res.status(404).send({ 'message' : 'product not found' });
                return;
            }
            // product exists
            
            // remove the product image gallery, if any
            for (var indx = 0; indx < _.size(product.gallery); indx++) {
                
                try {
                    fse.removeSync(config.file_server_root + '/' + product.gallery[indx]);
                }
                catch (error) {
                    res.status(500).send({ 'message' : error.message });
                    return;
                }
                
            }
            
            // cleanup product image gallery
            product.gallery = [];
            product.save(function(err, product) {
        
                if (err) {
                    res.status(500).send({ 'message' : err });
                    return;
                }
                // product save ok
    
                res.send({ 'message' : 'product image gallery deleted' });
                return;

            });
            
        });
        
    });
    
});
    
// -----------------------------------------------------------------------------
// ROUTES FOR ANNOUNCEMENT HANDLING
// -----------------------------------------------------------------------------
router.route('/vendor/:vendor_id/announcements')

// -----------------------------------------------------------------------------
// route for getting all specified vendors' announcements
// -----------------------------------------------------------------------------
.get(requireRole(['admin', 'user', 'guest']), function(req, res) {
    
    // validate request parameters
    
    // required parameters
    req.checkParams('vendor_id', 'invalid vendor').notEmpty().isMongoId();
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
    
    // parse query string parameters
    var fieldSpec = {
        //{name: {dataType: 'string', required: false}},
    };
    var useStrict = false;
    try {
        var cliQuery = queryProcessor(req.query, fieldSpec, useStrict);
    } catch (errors) {
        res.status(400).send(errors.message);
        return;
    }
    
    // find specified vendor
    Vendor.findById(req.params.vendor_id, function(err, vendor) {
            
        if (err) {
            res.status(500).send({ 'message' : err });
            return;
        }
        
        if (!vendor) {
            res.status(404).send({ 'message' : 'vendor not found' });
            return;
        }
        // vendor exists
        
        // find vendor's announcements
        var query = _.extend(cliQuery.filter,
            {'vendor_id' : vendor._id}
        );
        var options = {
            sort: cliQuery.sort,
            limit: cliQuery.limit,
            offset: cliQuery.offset
        };
        Announcement.paginate(query, options, function(err, announcements) {
                
            if (err) {
                res.status(500).send({ 'message' : err });
                return;
            }
            
            // announcements
            res.json( announcements );
            
        });
        
    });

})

// -----------------------------------------------------------------------------
// route for creating a new announcement
// -----------------------------------------------------------------------------
.post(requireRole(['admin', 'user']), function(req, res) {
    
    // validate request parameters
    
    // required parameters
    req.checkParams('vendor_id', 'invalid vendor').notEmpty().isMongoId();
    req.checkBody('announcement_text', 'invalid announcement text').notEmpty().isAscii();
    req.checkBody('image', 'invalid image').notEmpty().isAscii();
    
    // optional parameters
    req.checkBody('featured', 'invalid featured').optional().notEmpty().isBoolean();
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
    
    // find specified vendor
    Vendor.findById(req.params.vendor_id, function(err, vendor) {
            
        if (err) {
            res.status(500).send({ 'message' : err });
            return;
        }
        
        if (!vendor) {
            res.status(404).send({ 'message' : 'vendor not found' });
            return;
        }
        // vendor exists
        
        // insert the new announcement
        var announcement = new Announcement();
        for(var param in req.body) {
            announcement[param] = req.body[param];
        }
        announcement.vendor_id = req.params.vendor_id;
        
        // save
        announcement.save(function(err, announcement) {
            
            if (err) {
                res.status(500).send({ 'message' : err });
                return;
            }
            // announcement save ok
            
            // save this announcement in vendor's announcements ids
            vendor.announcements.push(announcement._id);
            vendor.save(function(err, vendor) {
                
                if (err) {
                    res.status(500).send({ 'message' : err });
                    return;
                }
                
                // create upload directory for this announcement
                // WARN: trust MongoDb will give us unique identifiers
                try {
                    
                    var file_upload_root = config.upload_root_dir
                        + '/'
                        + req.params.vendor_id
                        + '/'
                        + 'announcements';
                        
                    fse.mkdirsSync(
                        file_upload_root
                        + '/'
                        + announcement._id);
                    
                }
                catch (error) {
                    res.status(500).send({ 'message' : error.message });
                    return;
                }
                
                // return new announcement's id
                res.json( {'_id':announcement._id} );
                
                return;
            });
            
        });
        
    });
})

// -----------------------------------------------------------------------------
// route for deleting all announcements
// -----------------------------------------------------------------------------
.delete(requireRole(['admin', 'user']), function(req, res) {
    
    // validate request parameters
    
    // required parameters
    req.checkParams('vendor_id', 'invalid vendor').notEmpty().isMongoId();
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
    
    // find specified vendor
    Vendor.findById(req.params.vendor_id, function(err, vendor) {
            
        if (err) {
            res.status(500).send({ 'message' : err });
            return;
        }
        
        if (!vendor) {
            res.status(404).send({ 'message' : 'vendor not found' });
            return;
        }
        // vendor exists
        
        // clean announcements
        Announcement.remove({'vendor_id':vendor._id}, function(err) {
                
            if (err) {
                res.status(500).send({ 'message' : err });
                return;
            }
            
            // clean vendor
            vendor.announcements = [];
            vendor.save(function(err, vendor) {
            
                if (err) {
                    res.status(500).send({ 'message' : err });
                    return;
                }
                
                // cleanup upload directory for this vendor's announcements
                try {
                    
                    var file_upload_root = config.upload_root_dir
                        + '/'
                        + req.params.vendor_id
                        + '/'
                        + 'announcements';
                        
                    fse.removeSync(file_upload_root);
                    
                    fse.mkdirsSync(file_upload_root);
                    
                }
                catch (error) {
                    res.status(500).send({ 'message' : error.message });
                    return;
                }
                
                // done
                res.json({ 'message' : 'announcements empty' });
                
                return;
                
            });
                
        });
        
    });
    
});

// -----------------------------------------------------------------------------
// ROUTES FOR SPECIFIED ANNOUNCEMENT HANDLING
// -----------------------------------------------------------------------------
router.route('/vendor/:vendor_id/announcements/:announcement_id')

// -----------------------------------------------------------------------------
// route for getting specified announcement from specified vendor
// -----------------------------------------------------------------------------
.get(requireRole(['admin', 'user', 'guest']), function(req, res) {
        
    // validate request parameters
    
    // required parameters
    req.checkParams('vendor_id', 'invalid vendor').notEmpty().isMongoId();
    req.checkParams('announcement_id', 'invalid announcement').notEmpty().isMongoId();
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
    
    // find specified vendor
    Vendor.findById(req.params.vendor_id, function(err, vendor) {
    
        if (err) {
            res.status(500).send({ 'message' : err });
            return;
        }
        
        if (!vendor) {
            res.status(404).send({ 'message' : 'vendor not found' });
            return;
        }
        // vendor exists
        
        // find specified announcement
        Announcement.findById(req.params.announcement_id, function(err, announcement) {
    
            if (err) {
                res.status(500).send({ 'message' : err });
                return;
            }
            
            if (!announcement) {
                res.status(404).send({ 'message' : 'announcement not found' });
                return;
            }
            // announcement exists
            
            // return it
            res.json(announcement);
            
        });
        
    });
    
})

// -----------------------------------------------------------------------------
// route for updating specified announcement for specified vendor
// -----------------------------------------------------------------------------
.put(requireRole(['admin', 'user']), function(req, res) {
    // validate request parameters
    
    // required parameters
    req.checkParams('vendor_id', 'invalid vendor').notEmpty().isMongoId();
    req.checkParams('announcement_id', 'invalid announcement').notEmpty().isMongoId();
    req.checkBody('announcement_text', 'invalid announcement text').notEmpty().isAscii();
    req.checkBody('image', 'invalid image').notEmpty().isAscii();
    
    // optional parameters
    req.checkBody('featured', 'invalid featured').optional().notEmpty().isBoolean();
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
    
    // strip keys we do not want to handle here
    req.body = _.omit(req.body, ['_id', 'vendor_id', 'product', 'image']);
    
    // find specified vendor
    Vendor.findById(req.params.vendor_id, function(err, vendor) {
            
        if (err) {
            res.status(500).send({ 'message' : err });
            return;
        }
        
        if (!vendor) {
            res.status(404).send({ 'message' : 'vendor not found' });
            return;
        }
        // vendor exists
        
        // find specified announcement
        Announcement.findById(req.params.announcement_id, function(err, announcement) {
    
            if (err) {
                res.status(500).send({ 'message' : err });
                return;
            }
            
            if (!announcement) {
                res.status(404).send({ 'message' : 'announcement not found' });
                return;
            }
            // announcement exists
            
            // update it
            for(var param in req.body) {
                announcement[param] = req.body[param];
            }
            
            // save it
            announcement.save(function(err, announcement) {
                
                if (err) {
                    res.status(500).send({ 'message' : err });
                    return;
                }
                // announcement save ok
                
                res.send({ 'message' : 'announcement updated' });
                return;

            });
            
        });
        
    });
    
})

// -----------------------------------------------------------------------------
// route for deleting specified announcement from specified vendor
// -----------------------------------------------------------------------------
.delete(requireRole(['admin', 'user']), function(req, res) {
        
    // validate request parameters
    
    // required parameters
    req.checkParams('vendor_id', 'invalid vendor').notEmpty().isMongoId();
    req.checkParams('announcement_id', 'invalid product').notEmpty().isMongoId();
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
    
    // find specified vendor
    Vendor.findById(req.params.vendor_id, function(err, vendor) {
    
        if (err) {
            res.status(500).send({ 'message' : err });
            return;
        }
        
        if (!vendor) {
            res.status(404).send({ 'message' : 'vendor not found' });
            return;
        }
        // vendor exists
        
        // remove announcement
        Announcement.remove({
            '_id' : req.params.announcement_id,
            'vendor_id':vendor._id
        }, function(err) {
            
            if (err) {
                res.status(500).send({ 'message' : err });
                return;
            }
            
            // remove announcement id from vendor
            vendor.announcements = _.reject(vendor.announcements, function(a_id) {
                    return a_id == req.params.announcement_id 
            });
            
            // save vendor
            vendor.save(function(err, vendor) {
                
                if (err) {
                    res.status(500).send({ 'message' : err });
                    return;
                }
                
                try {
                    
                    var file_upload_root = config.upload_root_dir
                            + '/'
                            + req.params.vendor_id
                            + '/'
                            + 'announcements';
                            
                    fse.removeSync(file_upload_root
                            + '/'
                            + req.params.announcement_id);
                    
                }
                catch (error) {
                    res.status(500).send({ 'message' : error.message });
                    return;
                }
                
                res.send({ 'message' : 'announcement deleted' });
                return;
                
            });
            
        });
        
    });
        
});

// -----------------------------------------------------------------------------
// ROUTES FOR HANDLING SPECIFIED ANNOUNCEMENT'S IMAGE
// -----------------------------------------------------------------------------
router.route('/vendor/:vendor_id/announcements/:announcement_id/image')
    
// -----------------------------------------------------------------------------
// route for setting specified announcement's image
// -----------------------------------------------------------------------------
.post(requireRole(['admin', 'user']), function(req, res) {
        
    // validate request parameters
    
    // required parameters
    req.checkParams('vendor_id', 'invalid vendor').notEmpty().isMongoId();
    req.checkParams('announcement_id', 'invalid vendor').notEmpty().isMongoId();
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
    
    // find specified vendor
    Vendor.findById(req.params.vendor_id, function(err, vendor) {
            
        if (err) {
            res.status(500).send({ 'message' : err });
            return;
        }
        
        if (!vendor) {
            res.status(404).send({ 'message' : 'vendor not found' });
            return;
        }
        // vendor exists
        
        // find specified announcement
        Announcement.findById(req.params.announcement_id, function(err, announcement) {
    
            if (err) {
                res.status(500).send({ 'message' : err });
                return;
            }
            
            if (!announcement) {
                res.status(404).send({ 'message' : 'announcement not found' });
                return;
            }
            // announcement exists
            
            // remove the previous announcement image, if any
            if (announcement.image) {
                
                try {
                    fse.removeSync(config.file_server_root + '/' + announcement.image);
                }
                catch (error) {
                    res.status(500).send({ 'message' : error.message });
                    return;
                }
                
            }
            
            // proceed with upload
            var do_upload = multer_upload.single('announcement_image');
            do_upload(req, res, function(err) {
                    
                // WARN: err is the multer-specific error format
                
                if (err) {
                    res.status(500).send({ 
                        'message' : err.name + ':' + err.message
                    });
                    return;
                }
                // upload success
                
                // save the new announcement image URL
                announcement.image = getRelativePath(req.file.path, config.file_server_root);
                announcement.save(function(err, announcement) {
            
                        if (err) {
                            res.status(500).send({ 'message' : err });
                            return;
                        }
                        // announcement save ok
            
                        res.send({ 'message' : 'announcement image saved' });
                        return;

                });
            
            });
            
        });
        
    });
    
})

// -----------------------------------------------------------------------------
// route for deleting specified announcement's image
// -----------------------------------------------------------------------------
.delete(requireRole(['admin', 'user']), function(req, res) {
        
    // validate request parameters
    
    // required parameters
    req.checkParams('vendor_id', 'invalid vendor').notEmpty().isMongoId();
    req.checkParams('announcement_id', 'invalid vendor').notEmpty().isMongoId();
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
    
    // find specified vendor
    Vendor.findById(req.params.vendor_id, function(err, vendor) {
            
        if (err) {
            res.status(500).send({ 'message' : err });
            return;
        }
        
        if (!vendor) {
            res.status(404).send({ 'message' : 'vendor not found' });
            return;
        }
        // vendor exists
        
        // find specified announcement
        Announcement.findById(req.params.announcement_id, function(err, announcement) {
    
            if (err) {
                res.status(500).send({ 'message' : err });
                return;
            }
            
            if (!announcement) {
                res.status(404).send({ 'message' : 'announcement not found' });
                return;
            }
            // announcement exists
            
            // remove the previous announcement image, if any
            if (announcement.image) {
                
                try {
                    fse.removeSync(config.file_server_root + '/' + announcement.image);
                }
                catch (error) {
                    res.status(500).send({ 'message' : error.message });
                    return;
                }
                
            }
            
            // cleanup announcement image URL
            announcement.image = null;
            announcement.save(function(err, announcement) {
        
                if (err) {
                    res.status(500).send({ 'message' : err });
                    return;
                }
                // announcement save ok
    
                res.send({ 'message' : 'announcement image deleted' });
                return;

            });
            
        });
        
    });
    
});

// -----------------------------------------------------------------------------
// ROUTES FOR REQUEST HANDLING
// -----------------------------------------------------------------------------
router.route('/vendor/:vendor_id/requests')

// -----------------------------------------------------------------------------
// route for getting all specified vendors' requests
// -----------------------------------------------------------------------------
.get(requireRole(['admin', 'user']), function(req, res) {
    
    // validate request parameters
    
    // required parameters
    req.checkParams('vendor_id', 'invalid vendor').notEmpty().isMongoId();
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
    
    // parse query string parameters
    var fieldSpec = {
        //{name: {dataType: 'string', required: false}},
    };
    var useStrict = false;
    try {
        var cliQuery = queryProcessor(req.query, fieldSpec, useStrict);
    } catch (errors) {
        res.status(400).send(errors.message);
        return;
    }
    
    // find specified vendor
    Vendor.findById(req.params.vendor_id, function(err, vendor) {
            
        if (err) {
            res.status(500).send({ 'message' : err });
            return;
        }
        
        if (!vendor) {
            res.status(404).send({ 'message' : 'vendor not found' });
            return;
        }
        // vendor exists
        
        // find vendor's requests
        var query = _.extend(cliQuery.filter,
            {'vendor_id' : vendor._id}
        );
        var options = {
            populate: {'path':'product', 'select':{'name': 1, 'price': 1}},
            sort: cliQuery.sort,
            limit: cliQuery.limit,
            offset: cliQuery.offset
        };
        Request.paginate(query, options, function(err, requests) {
                
            if (err) {
                res.status(500).send({ 'message' : err });
                return;
            }
            
            // return this vendor's requests
            res.json( requests );
            
        });
        
    });

})

// -----------------------------------------------------------------------------
// route for creating a new request
// -----------------------------------------------------------------------------
.post(requireRole(['admin', 'user', 'guest']), function(req, res) {
    
    // validate request parameters
    
    // required parameters
    req.checkParams('vendor_id', 'invalid vendor').notEmpty().isMongoId();
    req.checkBody('product', 'invalid product').notEmpty().isMongoId();
    req.checkBody('name', 'invalid request name').notEmpty().isAscii();
    req.checkBody('email', 'invalid request email').notEmpty().isEmail();
    req.checkBody('phone', 'invalid request phone').notEmpty().isNumeric();
    req.checkBody('notes', 'invalid request notes').notEmpty().isAscii();
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
    
    // find specified vendor
    Vendor.findById(req.params.vendor_id, function(err, vendor) {
            
        if (err) {
            res.status(500).send({ 'message' : err });
            return;
        }
        
        if (!vendor) {
            res.status(404).send({ 'message' : 'vendor not found' });
            return;
        }
        // vendor exists
        
        // check if product exists for this vendor
        Product.find({
                'vendor_id': req.params.vendor_id,
                '_id' : req.body.product
                
        }, function(err, vendor_product) {
            
            if (err) {
                res.status(500).send({ 'message' : err });
                return;
            }
            
            if (!vendor_product) {
                res.status(404).send({ 'message' : 'product not found' });
                return;
            }
            // product exists
            
            // insert the new request
            var request = new Request();
            for(var param in req.body) {
                request[param] = req.body[param];
            }
            request.vendor_id = req.params.vendor_id;
            
            // save
            request.save(function(err, request) {
                
                if (err) {
                    res.status(500).send({ 'message' : err });
                    return;
                }
                // request save ok
                
                // save this request in vendor's requests ids
                vendor.requests.push(request._id);
                vendor.save(function(err, vendor) {
                    
                    if (err) {
                        res.status(500).send({ 'message' : err });
                        return;
                    }
                    
                    // return new request's id
                    res.json( {'_id':request._id} );
                    
                    return;
                });
                
            });
            
        });
        
    });
})

// -----------------------------------------------------------------------------
// route for deleting all requests
// -----------------------------------------------------------------------------
.delete(requireRole(['admin', 'user']), function(req, res) {
    
    // validate request parameters
    
    // required parameters
    req.checkParams('vendor_id', 'invalid vendor').notEmpty().isMongoId();
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
    
    // find specified vendor
    Vendor.findById(req.params.vendor_id, function(err, vendor) {
            
        if (err) {
            res.status(500).send({ 'message' : err });
            return;
        }
        
        if (!vendor) {
            res.status(404).send({ 'message' : 'vendor not found' });
            return;
        }
        // vendor exists
        
        // clean requests
        Request.remove({'vendor_id':vendor._id}, function(err) {
                
            if (err) {
                res.status(500).send({ 'message' : err });
                return;
            }
            
            // clean vendor
            vendor.requests = [];
            vendor.save(function(err, vendor) {
            
                if (err) {
                    res.status(500).send({ 'message' : err });
                    return;
                }
                
                // done
                res.json({ 'message' : 'requests empty' });
                
                return;
                
            });
                
        });
        
    });
    
});

// -----------------------------------------------------------------------------
// ROUTES FOR HANDLING SPECIFIED REQUEST
// -----------------------------------------------------------------------------
router.route('/vendor/:vendor_id/requests/:request_id')

// -----------------------------------------------------------------------------
// route for getting specified request from specified vendor
// -----------------------------------------------------------------------------
.get(requireRole(['admin', 'user']), function(req, res) {
        
    // validate request parameters
    
    // required parameters
    req.checkParams('vendor_id', 'invalid vendor').notEmpty().isMongoId();
    req.checkParams('request_id', 'invalid request').notEmpty().isMongoId();
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
    
    // find specified vendor
    Vendor.findById(req.params.vendor_id, function(err, vendor) {
    
        if (err) {
            res.status(500).send({ 'message' : err });
            return;
        }
        
        if (!vendor) {
            res.status(404).send({ 'message' : 'vendor not found' });
            return;
        }
        // vendor exists
        
        // find specified request
        Request
        .findById(req.params.request_id)
        .populate({'path':'product', 'select':{'name': 1, 'price': 1}})
        .exec(function(err, request) {
    
            if (err) {
                res.status(500).send({ 'message' : err });
                return;
            }
            
            if (!request) {
                res.status(404).send({ 'message' : 'request not found' });
                return;
            }
            // request exists
            
            // return it
            res.json(request);
            
        });
   
    });
})

// -----------------------------------------------------------------------------
// route for updating specified request for specified vendor
// -----------------------------------------------------------------------------
.put(requireRole(['admin', 'user']), function(req, res) {
    // validate request parameters
    
    // required parameters
    req.checkParams('vendor_id', 'invalid vendor').notEmpty().isMongoId();
    req.checkParams('request_id', 'invalid request').notEmpty().isMongoId();
    req.checkBody('name', 'invalid request name').notEmpty().isAscii();
    req.checkBody('email', 'invalid request email').notEmpty().isEmail();
    req.checkBody('phone', 'invalid request phone').notEmpty().isNumeric();
    req.checkBody('notes', 'invalid request notes').notEmpty().isAscii();
    req.checkBody('status', 'invalid request status').notEmpty().isIn(['pending', 'solved', 'rejected', 'workout']);
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
    
    // strip keys we do not want to handle here
    req.body = _.omit(req.body, ['_id', 'vendor_id', 'product']);
    
    // find specified vendor
    Vendor.findById(req.params.vendor_id, function(err, vendor) {
            
        if (err) {
            res.status(500).send({ 'message' : err });
            return;
        }
        
        if (!vendor) {
            res.status(404).send({ 'message' : 'vendor not found' });
            return;
        }
        // vendor exists
        
        // find specified request
        Request.findById(req.params.request_id, function(err, request) {
    
            if (err) {
                res.status(500).send({ 'message' : err });
                return;
            }
            
            if (!request) {
                res.status(404).send({ 'message' : 'request not found' });
                return;
            }
            // request exists
            
            // update it
            for(var param in req.body) {
                request[param] = req.body[param];
            }
            
            // save it
            request.save(function(err, request) {
                
                if (err) {
                    res.status(500).send({ 'message' : err });
                    return;
                }
                // request save ok
                
                res.send({ 'message' : 'request updated' });
                return;

            });
            
        });
        
    });
    
})

// -----------------------------------------------------------------------------
// route for deleting specified request from specified vendor
// -----------------------------------------------------------------------------
.delete(requireRole(['admin', 'user']), function(req, res) {
        
    // validate request parameters
    
    // required parameters
    req.checkParams('vendor_id', 'invalid vendor').notEmpty().isMongoId();
    req.checkParams('request_id', 'invalid request').notEmpty().isMongoId();
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
    
    // find specified vendor
    Vendor.findById(req.params.vendor_id, function(err, vendor) {
    
        if (err) {
            res.status(500).send({ 'message' : err });
            return;
        }
        
        if (!vendor) {
            res.status(404).send({ 'message' : 'vendor not found' });
            return;
        }
        // vendor exists
        
        // remove request
        Request.remove({
            '_id' : req.params.request_id,
            'vendor_id':vendor._id
        }, function(err) {
            
            if (err) {
                res.status(500).send({ 'message' : err });
                return;
            }
            
            // remove request id from vendor
            vendor.requests = _.reject(vendor.requests, function(r_id) {
                    return r_id == req.params.request_id 
            });
            
            // save vendor
            vendor.save(function(err, vendor) {
                
                if (err) {
                    res.status(500).send({ 'message' : err });
                    return;
                }
                
                res.send({ 'message' : 'request deleted' });
                return;
            });
            
        });
        
    });
        
});

// -----------------------------------------------------------------------------
// ROUTES FOR EMAIL HANDLING
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// route to send an e-mail to specified vendor's mailbox
// -----------------------------------------------------------------------------
router.post('/vendor/:vendor_id/mailbox',
    
    requireRole(['admin', 'user', 'guest']), function(req, res) {
        
    // validate request parameters
    
    // required parameters
    req.checkParams('vendor_id', 'invalid vendor').notEmpty().isMongoId();
    req.checkBody('name', 'invalid contact name').notEmpty().isAscii();
    req.checkBody('lastname', 'invalid contact lastname').notEmpty().isAscii();
    req.checkBody('email', 'invalid contact email').notEmpty().isEmail();
    req.checkBody('text', 'invalid mail text').notEmpty().isAscii(); // TODO: max long
    
    // optional parameters
    req.checkBody('phone', 'invalid contact phone').optional().notEmpty().isNumeric();
    
    // check for error
    var errors = req.validationErrors();
    if (errors) {
        res.status(400).json({'message' : errors});
        return;
    }
    
    // find specified vendor
    Vendor.findById(req.params.vendor_id, function(err, vendor) {
            
        if (err) {
            res.status(500).send({ 'message' : err });
            return;
        }
        
        if (!vendor) {
            res.status(404).send({ 'message' : 'vendor not found' });
            return;
        }
        // vendor exists
        
        // prepare email data
        var sender_info = 'Informazioni del Contatto:' + '\n';
        sender_info += 'Nome: ' + req.body.name + '\n';
        sender_info += 'Cognome: ' + req.body.lastname + '\n';
        sender_info += 'Email: ' + req.body.email + '\n';
        if (req.body.phone) {
            sender_info += 'Telefono:' + req.body.phone + '\n';
        }
        
        var mail_text = 'Hai una nuova richiesta di contatto!\n\n';
        mail_text += req.body.text + '\n' + '\n' + sender_info;
        
        // send email
        var mail = {
            from: req.body.email,
            to: vendor.contact.email,
            subject: 'info@' + vendor.contact.shopname,
            text: mail_text
        }
        transporter.sendMail(mail, function(err, info) {
                
            if (err) {
                res.status(500).send({ 'message' : err });
                return;
            }
            
            res.send({ 'message' : 'mail delivered to mailbox' });
            return;
                
        });
        
    });

});

module.exports = router;