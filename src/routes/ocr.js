import { Router } from "express";
import { body, validationResult } from "express-validator";

const router = Router();

router.post(
    "/",
    [],
    async (req, res, next) => {
        // OCR endpoint disabled: the app now uses AI-from-image pipeline directly
        return res.status(410).json({
            success: false,
            code: 'OCR_ENDPOINT_DISABLED',
            message: 'OCR endpoint disabled. Use AI-from-image unified pipeline.'
        });
    }
);

export default router;
