import { describe, it, expect, beforeEach } from '@jest/globals';
import User from '../../../src/models/User.js';
import { ValidationError } from '../../../src/utils/errors.js';

describe('User Model', () => {
    beforeEach(async () => {
        // Clean up users table before each test
        await User.destroy({ where: {}, force: true });
    });

    describe('User Creation', () => {
        it('should create a user with valid data', async () => {
            const userData = {
                email: 'test@example.com',
                username: 'testuser',
                password: 'Password123',
                firstName: 'Test',
                lastName: 'User'
            };

            const user = await User.create(userData);

            expect(user.id).toBeDefined();
            expect(user.email).toBe('test@example.com');
            expect(user.username).toBe('testuser');
            expect(user.firstName).toBe('Test');
            expect(user.lastName).toBe('User');
            expect(user.role).toBe('user');
            expect(user.isActive).toBe(true);
            expect(user.emailVerified).toBe(false);
            expect(user.password).not.toBe('Password123'); // Should be hashed
        });

        it('should hash password before saving', async () => {
            const userData = {
                email: 'test@example.com',
                username: 'testuser',
                password: 'Password123'
            };

            const user = await User.create(userData);
            expect(user.password).not.toBe('Password123');
            expect(user.password.length).toBeGreaterThan(50); // Bcrypt hash length
        });

        it('should normalize email to lowercase', async () => {
            const userData = {
                email: 'TEST@EXAMPLE.COM',
                username: 'testuser',
                password: 'Password123'
            };

            const user = await User.create(userData);
            expect(user.email).toBe('test@example.com');
        });

        it('should fail with invalid email', async () => {
            const userData = {
                email: 'invalid-email',
                username: 'testuser',
                password: 'Password123'
            };

            await expect(User.create(userData)).rejects.toThrow();
        });

        it('should fail with short username', async () => {
            const userData = {
                email: 'test@example.com',
                username: 'ab',
                password: 'Password123'
            };

            await expect(User.create(userData)).rejects.toThrow();
        });

        it('should fail with short password', async () => {
            const userData = {
                email: 'test@example.com',
                username: 'testuser',
                password: '123'
            };

            await expect(User.create(userData)).rejects.toThrow();
        });

        it('should fail with duplicate email', async () => {
            const userData = {
                email: 'test@example.com',
                username: 'testuser1',
                password: 'Password123'
            };

            await User.create(userData);

            const duplicateData = {
                email: 'test@example.com',
                username: 'testuser2',
                password: 'Password123'
            };

            await expect(User.create(duplicateData)).rejects.toThrow();
        });

        it('should fail with duplicate username', async () => {
            const userData = {
                email: 'test1@example.com',
                username: 'testuser',
                password: 'Password123'
            };

            await User.create(userData);

            const duplicateData = {
                email: 'test2@example.com',
                username: 'testuser',
                password: 'Password123'
            };

            await expect(User.create(duplicateData)).rejects.toThrow();
        });
    });

    describe('User Methods', () => {
        let user;

        beforeEach(async () => {
            user = await User.create({
                email: 'test@example.com',
                username: 'testuser',
                password: 'Password123'
            });
        });

        it('should compare password correctly', async () => {
            const isValid = await user.comparePassword('Password123');
            expect(isValid).toBe(true);

            const isInvalid = await user.comparePassword('wrongpassword');
            expect(isInvalid).toBe(false);
        });

        it('should check if user is locked', () => {
            expect(user.isLocked()).toBe(false);

            user.lockedUntil = new Date(Date.now() + 3600000); // 1 hour from now
            expect(user.isLocked()).toBe(true);

            user.lockedUntil = new Date(Date.now() - 3600000); // 1 hour ago
            expect(user.isLocked()).toBe(false);
        });

        it('should increment login attempts', async () => {
            expect(user.loginAttempts).toBe(0);

            await user.incrementLoginAttempts();
            expect(user.loginAttempts).toBe(1);

            // Simulate multiple failed attempts
            for (let i = 0; i < 4; i++) {
                await user.incrementLoginAttempts();
            }

            expect(user.loginAttempts).toBe(5);
            expect(user.lockedUntil).toBeDefined();
            expect(user.isLocked()).toBe(true);
        });

        it('should reset login attempts', async () => {
            user.loginAttempts = 3;
            user.lockedUntil = new Date(Date.now() + 3600000);

            await user.resetLoginAttempts();

            expect(user.loginAttempts).toBe(0);
            expect(user.lockedUntil).toBeNull();
            expect(user.lastLogin).toBeDefined();
        });

        it('should exclude sensitive data in JSON', () => {
            const json = user.toJSON();

            expect(json.password).toBeUndefined();
            expect(json.emailVerificationToken).toBeUndefined();
            expect(json.passwordResetToken).toBeUndefined();
            expect(json.passwordResetExpires).toBeUndefined();
            expect(json.loginAttempts).toBeUndefined();
            expect(json.lockedUntil).toBeUndefined();

            expect(json.id).toBeDefined();
            expect(json.email).toBeDefined();
            expect(json.username).toBeDefined();
        });
    });

    describe('User Static Methods', () => {
        beforeEach(async () => {
            await User.create({
                email: 'test@example.com',
                username: 'testuser',
                password: 'Password123'
            });
        });

        it('should find user by email', async () => {
            const user = await User.findByEmail('test@example.com');
            expect(user).toBeDefined();
            expect(user.email).toBe('test@example.com');

            const notFound = await User.findByEmail('notfound@example.com');
            expect(notFound).toBeNull();
        });

        it('should find user by username', async () => {
            const user = await User.findByUsername('testuser');
            expect(user).toBeDefined();
            expect(user.username).toBe('testuser');

            const notFound = await User.findByUsername('notfound');
            expect(notFound).toBeNull();
        });
    });
});