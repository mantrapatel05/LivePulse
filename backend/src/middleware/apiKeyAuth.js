const  Project = require('../models/Project');

const apiKeyAuth = async (req,res,next) =>{
    try{
        const apiKey = req.header('x-api-key');

        if(!apiKey){
            return res.status(401).json({message : 'API key is missing'});
        }

        const project = await Project.findOne({apiKey});

        if(!project){
            return res.status(401).json({message : 'Invalid API key'});
        }
        req.project = project; // Attach project to request for downstream use
        next();

    }catch(error){
        res.status(500).json({message : 'Auth error', error : error.message});
    }
};

module.exports = apiKeyAuth;