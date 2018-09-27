/**
 * Created by anlausch on 11/27/2017.
 */
'use strict';
const logger = require('./../util/logger.js');
const solrHelper = require('./../helpers/solrHelper').createSolrHelper();
const crossrefHelper = require('./../helpers/crossrefHelper').createCrossrefHelper();
const swbHelper = require('./../helpers/swbHelper').createSwbHelper();


function log(req, res){
    var response = res;
    var logObject = req.swagger.params.logObject.value;
    var ip = req.headers['x-forwarded-for'] ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        (req.connection.socket ? req.connection.socket.remoteAddress : null);
    logObject._ip = ip;
    logObject._user = req.user ? {username: req.user.username, userid: req.user._id.toString()} : "USER_UNKNOWN";
    logger.info("EVALUATION_LOG", logObject);
    return response.json({message: "Logging suceeded."});
}

function getK10Plus(req, res){
    var response = res;
    var query = req.swagger.params.query.value;
    solrHelper.queryK10plusByQueryString(query, function(err,res){
        if(err){
            logger.error(err);
            return response.json(err);
        }
        logger.log(res);
        return response.json(res);
    });
}

function getGVI(req, res){
    var response = res;
    var query = req.swagger.params.query.value;
    solrHelper.queryGVIByQueryString(query, function(err,res){
        if(err){
            logger.error(err);
            return response.json(err);
        }
        logger.log(res);
        return response.json(res);
    });
}

function getCrossref(req, res){
    var response = res;
    var query = req.swagger.params.query.value;
    crossrefHelper.query(query, function(err,res){
        if(err){
            logger.error(err);
            return response.json(err);
        }
        logger.log(res);
        return response.json(res);
    });
}

function getSWB(req, res){
    var response = res;
    var query = req.swagger.params.query.value;
    swbHelper.queryByQueryString(query, function(err,res){
        if(err){
            logger.error(err);
            return response.json(err);
        }
        logger.log(res);
        return response.json(res);
    });
}


module.exports = {
    log: log,
    getK10Plus: getK10Plus,
    getGVI: getGVI,
    getCrossref: getCrossref,
    getSWB: getSWB
};