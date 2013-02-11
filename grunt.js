module.exports = function(grunt) {
  'use strict';

  // Project configuration.
  grunt.initConfig({
    pkg: '<json:package.json>',
    compass: { // http://compass-style.org/help/tutorials/configuration-reference/#configuration-properties
        options: {
          css_dir: 'public/css',
          sass_dir: 'scss',
          debug_info: true,
          images_dir: 'public/images',
          javascripts_dir: 'public/js',
          force: true
        }
    },
    lint: {
      files: ['grunt.js', 'routes/*.js'] // we would usually do **/*.js but we don't want to lint the lib files
    },
    watch: {
        compass: {
            files: 'scss/**/*.scss',
            tasks: 'compass'
        }
    },
    jshint: {
      options: {
        curly: true,
        eqeqeq: true,
        immed: true,
        latedef: true,
        newcap: true,
        noarg: true,
        sub: true,
        undef: true,
        boss: true,
        eqnull: true,
        node: true
      },
      globals: {
        exports: true
      }
    }
  });

  grunt.loadNpmTasks('grunt-compass');

  // Default task.
  grunt.registerTask('default', 'compass');
};