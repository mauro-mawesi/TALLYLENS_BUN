import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import User from '../../src/models/User.js';
import RefreshToken from '../../src/models/RefreshToken.js';

describe('Authentication Integration Tests', () => {
    let server;
    let testUser;

    beforeEach(async () => {
        // Clean up tables
        await RefreshToken.destroy({ where: {}, force: true });
        await User.destroy({ where: {}, force: true });

        // Create a test user
        testUser = await User.create({
            email: 'test@example.com',
            username: 'testuser',
            password: 'Password123',
            firstName: 'Test',
            lastName: 'User'
        });
    });

    describe('POST /api/auth/register', () => {
        it('should register a new user successfully', async () => {
            const userData = {
                email: 'newuser@example.com',
                username: 'newuser',
                password: 'Password123',
                firstName: 'New',
                lastName: 'User'
            };

            const response = await request(app)
                .post('/api/auth/register')
                .send(userData)
                .expect(201);

            expect(response.body.status).toBe('success');
            expect(response.body.data.user.email).toBe('newuser@example.com');
            expect(response.body.data.user.username).toBe('newuser');
            expect(response.body.data.user.password).toBeUndefined();
            expect(response.body.data.tokens.accessToken).toBeDefined();
            expect(response.body.data.tokens.refreshToken).toBeDefined();
        });

        it('should fail with duplicate email', async () => {
            const userData = {
                email: 'test@example.com', // Already exists
                username: 'newuser',
                password: 'Password123'
            };

            const response = await request(app)
                .post('/api/auth/register')
                .send(userData)
                .expect(409);

            expect(response.body.status).toBe('error');
            expect(response.body.message).toContain('Email already registered');
        });

        it('should fail with invalid email', async () => {
            const userData = {
                email: 'invalid-email',
                username: 'newuser',
                password: 'Password123'
            };

            const response = await request(app)
                .post('/api/auth/register')
                .send(userData)
                .expect(400);

            expect(response.body.status).toBe('fail');
        });

        it('should fail with weak password', async () => {
            const userData = {
                email: 'newuser@example.com',
                username: 'newuser',
                password: 'weak'
            };

            const response = await request(app)
                .post('/api/auth/register')
                .send(userData)
                .expect(400);

            expect(response.body.status).toBe('fail');
        });
    });

    describe('POST /api/auth/login', () => {
        it('should login with email successfully', async () => {
            const loginData = {
                email: 'test@example.com',
                password: 'Password123'
            };

            const response = await request(app)
                .post('/api/auth/login')
                .send(loginData)
                .expect(200);

            expect(response.body.status).toBe('success');
            expect(response.body.data.user.email).toBe('test@example.com');
            expect(response.body.data.tokens.accessToken).toBeDefined();
            expect(response.body.data.tokens.refreshToken).toBeDefined();
        });

        it('should login with username successfully', async () => {
            const loginData = {
                username: 'testuser',
                password: 'Password123'
            };

            const response = await request(app)
                .post('/api/auth/login')
                .send(loginData)
                .expect(200);

            expect(response.body.status).toBe('success');
            expect(response.body.data.user.username).toBe('testuser');
        });

        it('should fail with wrong password', async () => {
            const loginData = {
                email: 'test@example.com',
                password: 'wrongpassword'
            };

            const response = await request(app)
                .post('/api/auth/login')
                .send(loginData)
                .expect(401);

            expect(response.body.status).toBe('error');
            expect(response.body.message).toContain('Invalid credentials');
        });

        it('should fail with non-existent user', async () => {
            const loginData = {
                email: 'notfound@example.com',
                password: 'Password123'
            };

            const response = await request(app)
                .post('/api/auth/login')
                .send(loginData)
                .expect(401);

            expect(response.body.status).toBe('error');
        });

        it('should fail with inactive user', async () => {
            await testUser.update({ isActive: false });

            const loginData = {
                email: 'test@example.com',
                password: 'Password123'
            };

            const response = await request(app)
                .post('/api/auth/login')
                .send(loginData)
                .expect(401);

            expect(response.body.message).toContain('deactivated');
        });
    });

    describe('POST /api/auth/refresh', () => {
        let refreshToken;

        beforeEach(async () => {
            // Login to get a refresh token
            const loginResponse = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'test@example.com',
                    password: 'Password123'
                });

            refreshToken = loginResponse.body.data.tokens.refreshToken;
        });

        it('should refresh access token successfully', async () => {
            const response = await request(app)
                .post('/api/auth/refresh')
                .send({ refreshToken })
                .expect(200);

            expect(response.body.status).toBe('success');
            expect(response.body.data.accessToken).toBeDefined();
            expect(response.body.data.refreshToken).toBeDefined();
            expect(response.body.data.refreshToken).not.toBe(refreshToken); // New token
        });

        it('should fail with invalid refresh token', async () => {
            const response = await request(app)
                .post('/api/auth/refresh')
                .send({ refreshToken: 'invalid-token' })
                .expect(401);

            expect(response.body.status).toBe('error');
        });

        it('should fail with expired refresh token', async () => {
            // Manually expire the token
            const token = await RefreshToken.findOne({ where: { token: refreshToken } });
            await token.update({ expiresAt: new Date(Date.now() - 1000) });

            const response = await request(app)
                .post('/api/auth/refresh')
                .send({ refreshToken })
                .expect(401);

            expect(response.body.status).toBe('error');
        });
    });

    describe('GET /api/auth/me', () => {
        let accessToken;

        beforeEach(async () => {
            const loginResponse = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'test@example.com',
                    password: 'Password123'
                });

            accessToken = loginResponse.body.data.tokens.accessToken;
        });

        it('should get current user profile', async () => {
            const response = await request(app)
                .get('/api/auth/me')
                .set('Authorization', `Bearer ${accessToken}`)
                .expect(200);

            expect(response.body.status).toBe('success');
            expect(response.body.data.user.email).toBe('test@example.com');
            expect(response.body.data.user.password).toBeUndefined();
        });

        it('should fail without token', async () => {
            const response = await request(app)
                .get('/api/auth/me')
                .expect(401);

            expect(response.body.status).toBe('error');
        });

        it('should fail with invalid token', async () => {
            const response = await request(app)
                .get('/api/auth/me')
                .set('Authorization', 'Bearer invalid-token')
                .expect(401);

            expect(response.body.status).toBe('error');
        });
    });

    describe('POST /api/auth/logout', () => {
        let refreshToken;

        beforeEach(async () => {
            const loginResponse = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'test@example.com',
                    password: 'Password123'
                });

            refreshToken = loginResponse.body.data.tokens.refreshToken;
        });

        it('should logout successfully', async () => {
            const response = await request(app)
                .post('/api/auth/logout')
                .send({ refreshToken })
                .expect(200);

            expect(response.body.status).toBe('success');

            // Token should be revoked
            const token = await RefreshToken.findOne({ where: { token: refreshToken } });
            expect(token.revoked).toBe(true);
        });

        it('should handle invalid refresh token gracefully', async () => {
            const response = await request(app)
                .post('/api/auth/logout')
                .send({ refreshToken: 'invalid-token' })
                .expect(200);

            expect(response.body.status).toBe('success');
        });
    });
});