import express, { Request, Response, NextFunction } from 'express';

const ProfileNetworthCalculator = require('../calculators/ProfileNetworthCalculator');

const app = express();
const PORT = process.env.PORT || 8005;

// what profile need 25mb???
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

const validateContentType = (req: Request, res: Response, next: NextFunction) => {
    if (req.headers['content-type'] !== 'application/json') {
        res.status(400).json({
            message: 'Invalid content type. Only application/json is accepted',
        });
        return;
    }
    next();
};

app.post('/networth',
    validateContentType,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const networthManager = new ProfileNetworthCalculator(req.body.profile, req.body.museum, req.body.banking || 0);

            let networth: null;

            const cosmetic = req.query.cosmetic

            console.log(cosmetic ? "Getting networth" : "Getting networth with cosmetic......")

            if (cosmetic) {
                networth = await networthManager.getNetworth({ includeItemData: true });
            } else {
                networth = await networthManager.getNonCosmeticNetworth({includeItemData: true})
            }
            res.status(200).json({
                message: 'success',
                data: {
                    networth,
                }
            });
        } catch (error) {
            next(error);
        }
    }
);

app.use((req: Request, res: Response) => {
    res.status(404).json({
        message: 'Not Found',
    });
});

const errorHandler = (err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error('Error:', err.stack);

    res.status(500).json({
        message: err.message || 'Internal Server Error',
    });
};

app.use(errorHandler);

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}).on('error', (err: any) => {
    console.error('Server failed to start:', err);
});