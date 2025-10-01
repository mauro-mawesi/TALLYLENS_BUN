import { Router } from "express";
import { body, validationResult } from "express-validator";
import { extractTextFromImage } from "../services/ocrService.js";

const router = Router();

router.post(
    "/",
    [
        body("image_url").isString().withMessage("image_url debe ser un string"),
        body("engine").optional().isIn(["auto", "local", "vision"]).withMessage("engine inválido"),
        body("mlkitProcessed").optional().isBoolean().withMessage("mlkitProcessed debe ser boolean")
    ],
    async (req, res, next) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ success: false, errors: errors.array() });
            }

            const { image_url, engine = 'auto', mlkitProcessed = false } = req.body;
            const text = await extractTextFromImage(image_url, { engine, mlkitProcessed });

            if (!text) {
                return res.status(422).json({
                    success: false,
                    error: "No se pudo extraer texto de la imagen."
                });
            }

            res.json({ success: true, engine, mlkitProcessed, text });
        } catch (err) {
            next(err);
        }
    }
);

export default router;
