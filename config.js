module.exports = {
    
    // API version
    'version': '0.6.0',
    
    // loglevel
    'loglevel': 'dev',

    // database URL
    'database': '127.0.0.1:27017/ecommerce',
    
    // JSON token secret
    'secret': 'thequickbrownfoxjumpsoverthelazydog',
    
    // JSON token expiry time (secs)
    'token_expiry_time': 60 * 60 * 24,
    
    // application name
    'app_name': 'ecommerce',
    
    // application port
    'app_port': 3030,
    
    // file upload configurations
    
    // full path to file server root directory
    'file_server_root': '/usr/local',
    
    // full path to upload root directory: we need read/write permissions on 
    // this directory and it has to be visible by the web server serving the
    // files
    'upload_root_dir': '/usr/local/uploads',
    
    // max field name size (in bytes)
    'upload_max_field_name_size' : 50,
    
    // max field value size (in bytes)
    'upload_max_field_size' : 1,
    
    // max number of non-file fields
    'upload_max_fields' : 1,
    
    // maximum upload file size (bytes)
    'upload_max_file_size' : 3000,
    
    // max upload items for a single upload request
    'upload_max_files_per_request': 1,
    
    // for multipart forms, the max number of header key=>value pairs to parse
    'upload_max_header_pairs' : 2000,
    
    // max product image gallery size
    'max_product_image_gallery_size': 5
    
};
