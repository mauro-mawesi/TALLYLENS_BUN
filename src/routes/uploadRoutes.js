import { Router } from "express";
import { uploadReceipt } from "../controllers/uploadController.js";

const router = Router();

router.post("/", ...uploadReceipt);

export default router;
