import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from 'dotenv';
import { VroomORS } from './index.js';
import { VroomProblem, ORSDirectionsOptions } from './types.js';

config();

const app: express.Application = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));

// Initialize VroomORS
const orsApiKey = process.env.ORS_API_KEY || '';
const orsBaseUrl = process.env.ORS_BASE_URL || 'http://localhost:8080';
const vroomEndpoint = process.env.VROOM_ENDPOINT || 'http://localhost:3000';

// if (!orsApiKey) {
//   console.error('ERROR: ORS_API_KEY environment variable is required');
//   process.exit(1);
// }

const vroomOrs = new VroomORS(orsApiKey, vroomEndpoint, orsBaseUrl);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// Main VROOM solve endpoint
app.post('/solve', async (req, res) => {
  try {
    const { problem, orsOptions } = req.body;

    // Basic validation
    if (!problem) {
      return res.status(400).json({
        error: 'Missing required field: problem',
        message: 'Request body must contain a "problem" field with VROOM problem definition'
      });
    }

    if (!problem.vehicles || !Array.isArray(problem.vehicles) || problem.vehicles.length === 0) {
      return res.status(400).json({
        error: 'Invalid problem: vehicles',
        message: 'Problem must contain at least one vehicle'
      });
    }

    if (!problem.jobs || !Array.isArray(problem.jobs)) {
      problem.jobs = [];
    }

    console.log(`Solving VROOM problem with ${problem.vehicles.length} vehicles, ${problem.jobs.length} jobs, ${problem.shipments?.length || 0} shipments`);

    const solution = await vroomOrs.solve(problem as VroomProblem, orsOptions as ORSDirectionsOptions);

    res.json({
      success: true,
      solution,
      metadata: {
        vehicles: problem.vehicles.length,
        jobs: problem.jobs.length,
        shipments: problem.shipments?.length || 0,
        solved_at: new Date().toISOString()
      }
    });

  } catch (error: any) {
    console.error('VROOM solve error:', error);

    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message || 'An error occurred while solving the VROOM problem',
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
  }
});

// Get matrix only (without solving VROOM)
app.post('/matrix', async (req, res) => {
  try {
    const { locations, orsOptions } = req.body;

    if (!locations || !Array.isArray(locations) || locations.length === 0) {
      return res.status(400).json({
        error: 'Missing required field: locations',
        message: 'Request body must contain a "locations" array with coordinate pairs'
      });
    }

    console.log(`Creating matrix for ${locations.length} locations`);

    const matrix = await vroomOrs.getMatrix(
      locations.map((loc: [number, number]) => ({ lat: loc[1], lng: loc[0] })),
      orsOptions as ORSDirectionsOptions
    );

    res.json({
      success: true,
      matrix,
      metadata: {
        locations: locations.length,
        matrix_size: `${locations.length}x${locations.length}`,
        created_at: new Date().toISOString()
      }
    });

  } catch (error: any) {
    console.error('Matrix creation error:', error);

    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message || 'An error occurred while creating the matrix',
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
  }
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: 'An unexpected error occurred'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not found',
    message: `Endpoint ${req.method} ${req.path} not found`,
    availableEndpoints: ['/health', '/solve', '/matrix']
  });
});

// Start server
app.listen(port, () => {
  console.log(`🚚 VROOM-ORS-DIRECTIONS API server running on port ${port}`);
  console.log(`🏥 Health check: http://localhost:${port}/health`);
  console.log(`🗺️  ORS API Key: ${orsApiKey ? '✅ Configured' : '❌ Missing'}`);
  console.log(`🌐 ORS Base URL: ${orsBaseUrl || 'https://api.openrouteservice.org (default)'}`);
  console.log(`🚛 VROOM Endpoint: ${vroomEndpoint}`);
});

export default app;