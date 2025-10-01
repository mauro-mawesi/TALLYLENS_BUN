import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import config from './environment.js';

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Receipts Management API',
            version: '1.0.0',
            description: 'A comprehensive API for managing receipts with OCR and AI categorization capabilities',
            contact: {
                name: 'API Support',
                email: 'support@receiptsapp.com'
            },
            license: {
                name: 'MIT',
                url: 'https://opensource.org/licenses/MIT'
            }
        },
        servers: [
            {
                url: config.isDevelopment ? `http://localhost:${config.server.port}` : 'https://api.receiptsapp.com',
                description: config.isDevelopment ? 'Development server' : 'Production server'
            }
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                    description: 'Enter JWT Bearer token'
                }
            },
            schemas: {
                Error: {
                    type: 'object',
                    properties: {
                        status: {
                            type: 'string',
                            enum: ['error', 'fail']
                        },
                        message: {
                            type: 'string'
                        },
                        errors: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    field: { type: 'string' },
                                    message: { type: 'string' },
                                    value: { type: 'string' }
                                }
                            }
                        }
                    }
                },
                ValidationError: {
                    allOf: [
                        { $ref: '#/components/schemas/Error' },
                        {
                            type: 'object',
                            properties: {
                                status: {
                                    type: 'string',
                                    enum: ['fail']
                                }
                            }
                        }
                    ]
                },
                User: {
                    type: 'object',
                    properties: {
                        id: {
                            type: 'string',
                            format: 'uuid',
                            description: 'Unique user identifier'
                        },
                        email: {
                            type: 'string',
                            format: 'email',
                            description: 'User email address'
                        },
                        username: {
                            type: 'string',
                            minLength: 3,
                            maxLength: 30,
                            description: 'Unique username'
                        },
                        firstName: {
                            type: 'string',
                            maxLength: 50,
                            description: 'User first name'
                        },
                        lastName: {
                            type: 'string',
                            maxLength: 50,
                            description: 'User last name'
                        },
                        role: {
                            type: 'string',
                            enum: ['user', 'admin', 'moderator'],
                            description: 'User role'
                        },
                        isActive: {
                            type: 'boolean',
                            description: 'Whether the user account is active'
                        },
                        emailVerified: {
                            type: 'boolean',
                            description: 'Whether the user email is verified'
                        },
                        lastLogin: {
                            type: 'string',
                            format: 'date-time',
                            description: 'Last login timestamp'
                        },
                        createdAt: {
                            type: 'string',
                            format: 'date-time',
                            description: 'Account creation timestamp'
                        },
                        updatedAt: {
                            type: 'string',
                            format: 'date-time',
                            description: 'Last update timestamp'
                        }
                    }
                },
                Receipt: {
                    type: 'object',
                    properties: {
                        id: {
                            type: 'string',
                            format: 'uuid',
                            description: 'Unique receipt identifier'
                        },
                        userId: {
                            type: 'string',
                            format: 'uuid',
                            description: 'ID of the user who owns this receipt'
                        },
                        imageUrl: {
                            type: 'string',
                            format: 'uri',
                            description: 'URL to the receipt image'
                        },
                        imageThumbnailUrl: {
                            type: 'string',
                            format: 'uri',
                            description: 'URL to the receipt thumbnail image'
                        },
                        rawText: {
                            type: 'string',
                            description: 'Raw text extracted from OCR'
                        },
                        parsedData: {
                            type: 'object',
                            description: 'Structured data parsed from the receipt',
                            properties: {
                                merchant: { type: 'string' },
                                date: { type: 'string', format: 'date' },
                                total: { type: 'number' },
                                items: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            name: { type: 'string' },
                                            price: { type: 'number' },
                                            quantity: { type: 'integer' }
                                        }
                                    }
                                }
                            }
                        },
                        category: {
                            type: 'string',
                            enum: ['Mercado', 'Transporte', 'Comida', 'Combustible', 'Otros'],
                            description: 'AI-categorized receipt category'
                        },
                        amount: {
                            type: 'number',
                            format: 'decimal',
                            minimum: 0,
                            description: 'Total amount on the receipt'
                        },
                        currency: {
                            type: 'string',
                            minLength: 3,
                            maxLength: 3,
                            description: 'Currency code (ISO 4217)'
                        },
                        merchantName: {
                            type: 'string',
                            description: 'Name of the merchant/store'
                        },
                        purchaseDate: {
                            type: 'string',
                            format: 'date-time',
                            description: 'Date of purchase'
                        },
                        tags: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'User-defined tags'
                        },
                        notes: {
                            type: 'string',
                            description: 'User notes about the receipt'
                        },
                        isProcessed: {
                            type: 'boolean',
                            description: 'Whether OCR and categorization are complete'
                        },
                        processingStatus: {
                            type: 'string',
                            enum: ['pending', 'processing', 'completed', 'failed'],
                            description: 'Current processing status'
                        },
                        processingError: {
                            type: 'string',
                            description: 'Error message if processing failed'
                        },
                        createdAt: {
                            type: 'string',
                            format: 'date-time'
                        },
                        updatedAt: {
                            type: 'string',
                            format: 'date-time'
                        }
                    }
                },
                Tokens: {
                    type: 'object',
                    properties: {
                        accessToken: {
                            type: 'string',
                            description: 'JWT access token for API authentication'
                        },
                        refreshToken: {
                            type: 'string',
                            description: 'Refresh token for obtaining new access tokens'
                        }
                    }
                },
                PaginationMeta: {
                    type: 'object',
                    properties: {
                        currentPage: { type: 'integer', minimum: 1 },
                        totalPages: { type: 'integer', minimum: 0 },
                        totalCount: { type: 'integer', minimum: 0 },
                        limit: { type: 'integer', minimum: 1 },
                        hasNext: { type: 'boolean' },
                        hasPrevious: { type: 'boolean' }
                    }
                }
            },
            responses: {
                BadRequest: {
                    description: 'Bad Request - Invalid input parameters',
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/ValidationError' }
                        }
                    }
                },
                Unauthorized: {
                    description: 'Unauthorized - Authentication required',
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/Error' }
                        }
                    }
                },
                Forbidden: {
                    description: 'Forbidden - Insufficient permissions',
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/Error' }
                        }
                    }
                },
                NotFound: {
                    description: 'Not Found - Resource does not exist',
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/Error' }
                        }
                    }
                },
                Conflict: {
                    description: 'Conflict - Resource already exists',
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/Error' }
                        }
                    }
                },
                TooManyRequests: {
                    description: 'Too Many Requests - Rate limit exceeded',
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/Error' }
                        }
                    }
                },
                InternalServerError: {
                    description: 'Internal Server Error',
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/Error' }
                        }
                    }
                }
            },
            parameters: {
                PageQuery: {
                    name: 'page',
                    in: 'query',
                    description: 'Page number for pagination',
                    required: false,
                    schema: {
                        type: 'integer',
                        minimum: 1,
                        default: 1
                    }
                },
                LimitQuery: {
                    name: 'limit',
                    in: 'query',
                    description: 'Number of items per page',
                    required: false,
                    schema: {
                        type: 'integer',
                        minimum: 1,
                        maximum: 100,
                        default: 20
                    }
                },
                CategoryQuery: {
                    name: 'category',
                    in: 'query',
                    description: 'Filter by receipt category',
                    required: false,
                    schema: {
                        type: 'string',
                        enum: ['Mercado', 'Transporte', 'Comida', 'Combustible', 'Otros']
                    }
                }
            }
        },
        tags: [
            {
                name: 'Authentication',
                description: 'User authentication and account management'
            },
            {
                name: 'Receipts',
                description: 'Receipt management operations'
            },
            {
                name: 'Upload',
                description: 'File upload operations'
            },
            {
                name: 'OCR',
                description: 'Optical Character Recognition operations'
            },
            {
                name: 'Health',
                description: 'API health and status endpoints'
            }
        ]
    },
    apis: [
        './src/routes/*.js',
        './src/controllers/*.js',
        './src/models/*.js'
    ]
};

const specs = swaggerJsdoc(options);

export const setupSwagger = (app) => {
    // Swagger page
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs, {
        explorer: true,
        customSiteTitle: 'Receipts API Documentation',
        customCss: `
            .swagger-ui .topbar { display: none }
            .swagger-ui .info { margin: 50px 0 }
            .swagger-ui .scheme-container { background: #f8f9fa; padding: 20px; border-radius: 5px; }
        `,
        swaggerOptions: {
            persistAuthorization: true,
            displayRequestDuration: true,
            docExpansion: 'none',
            filter: true,
            showExtensions: true,
            tryItOutEnabled: true
        }
    }));

    // JSON endpoint
    app.get('/api-docs.json', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(specs);
    });

    console.log(`📚 Swagger documentation available at: ${config.isDevelopment ? `http://localhost:${config.server.port}` : 'https://api.receiptsapp.com'}/api-docs`);
};

export default specs;