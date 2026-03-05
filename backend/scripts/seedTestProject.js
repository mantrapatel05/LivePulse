require('dotenv').config();
const mongoose = require('mongoose');
const Project = require('../src/models/Project');

const TEST_PROJECT_ID = '699d9becf25204ae69676baa';
const TEST_API_KEY = 'lp_test_local_key_123';

async function run() {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI is missing in environment');
    }

    await mongoose.connect(process.env.MONGO_URI);

    const existingById = await Project.findById(TEST_PROJECT_ID);
    const existingByApiKey = await Project.findOne({ apiKey: TEST_API_KEY });
    let project = null;

    // If API key is already used by some other project, free it first.
    if (existingByApiKey && String(existingByApiKey._id) !== TEST_PROJECT_ID) {
      existingByApiKey.apiKey = `lp_old_${Date.now()}`;
      await existingByApiKey.save();
    }

    if (existingById) {
      existingById.name = 'LivePulse Test Project';
      existingById.supabaseUserId = 'local-test-user';
      existingById.apiKey = TEST_API_KEY;
      project = await existingById.save();
    } else {
      project = await Project.create({
        _id: new mongoose.Types.ObjectId(TEST_PROJECT_ID),
        name: 'LivePulse Test Project',
        apiKey: TEST_API_KEY,
        supabaseUserId: 'local-test-user'
      });
    }

    console.log('Test project ready');
    console.log('projectId:', String(project._id));
    console.log('apiKey:', project.apiKey);
  } catch (error) {
    console.error('Failed to seed test project:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

run();
