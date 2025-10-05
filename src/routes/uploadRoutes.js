import { Router } from "express";
import { uploadReceipt, uploadProfilePhoto } from "../controllers/uploadController.js";
import { authenticate } from "../middlewares/auth.js";

const router = Router();

// Specific endpoints
router.post("/receipt", authenticate, ...uploadReceipt);
router.post("/profile", authenticate, ...uploadProfilePhoto);

// Legacy endpoint for backwards compatibility (defaults to receipt upload)
router.post("/", authenticate, ...uploadReceipt);

export default router;
