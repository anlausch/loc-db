const should = require('should');
const setup = require('./../setup.js').createSetup();
const openCitationsHelper = require('./../../../api/helpers/openCitationsHelper.js').createOpenCitationsHelper();

describe('helpers', function() {
    describe('openCitationsHelper', function() {
        before(function(done) {
            setup.dropDB(function(err){
                done();
            });
        });
        
        after(function(done) {
            setup.dropDB(function(err){
                done();
            });
        });
        
        describe('query', function(){
            it('should return result for a given query', function(done) {
                this.timeout(100000);
                openCitationsHelper.query("Circulation Research", function(result){
                    console.log(result);
                    result.should.be.ok();
                    done();
                });
            });
        });
    });
});