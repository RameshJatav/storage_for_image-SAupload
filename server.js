require('dotenv').config();
const express = require('express');
const fileUpload = require('express-fileupload');
const bodyParser = require('body-parser');
const db = require('./connections/mysql');
const app = express();

const cors = require("cors");

const userApis = require("./routes/Users");

// Middleware
app.use(bodyParser.json());
app.use(fileUpload());
app.use(cors());

app.use("/users", userApis);

// Middleware to check if email_id is provided
const verifyEmail = (req, res, next) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ message: 'Email ID is required.' });
    }
    req.email = email; // Save email_id for further use
    next();
};
function verifyEmail1(req, res, next) {
    const email = req.headers.authorization?.split(' ')[1]; // Extract email from Authorization header
    if (!email) {
        return res.status(401).json({ message: 'Unauthorized: No email provided.' });
    }
    req.email = email;  
    next();
}


// Upload API
app.post('/api/upload', verifyEmail, (req, res) => {
    if (!req.files || Object.keys(req.files).length === 0) {
        return res.status(400).send('No files were uploaded.');
    }

    const files = Array.isArray(req.files.images) ? req.files.images : [req.files.images];
    const { email } = req.body; // Changed to req.body for FormData

    let uploadPromises = files.map((file) => {
        const fileName = file.name;
        const fileData = file.data;

        return new Promise((resolve, reject) => {
            db.query(
                'INSERT INTO images (image_name, image_url, email_id) VALUES (?, ?, ?)',
                [fileName, fileData, email],
                (err, result) => {
                    if (err) return reject(err);
                    resolve({ id: result.insertId, imageName: fileName, imageData: fileData.toString('base64') });
                }
            );
        });
    });

    Promise.all(uploadPromises)
        .then((results) => res.status(200).json({ success: true, images: results }))
        .catch((err) => res.status(500).send(err.message));
});


// Fetch Images API (by email_id)
app.get('/api/images', verifyEmail1, (req, res) => {
    const { email } = req;

    db.query(
        'SELECT id, image_name, image_url FROM images WHERE email_id = ? ORDER BY uploaded_at DESC',
        [email],
        (err, results) => {
            if (err) {
                console.error('Error fetching images:', err);
                return res.status(500).json({ message: 'Failed to fetch images.' });
            }

            const images = results.map((row) => ({
                id: row.id,
                imageName: row.image_name,
                imageUrl: `data:image/jpeg;base64,${row.image_url.toString('base64')}`,
            }));
            res.json(images);
        }
    );
});

// Fetch a single image by ID (by email_id)
app.get('/api/show_one/:id', verifyEmail1, (req, res) => {
    const id = req.params.id;
    const { email } = req;

    if (!id) {
        return res.status(400).json({ message: 'Image ID is required.' });
    }

    db.query('SELECT id, image_name, image_url FROM images WHERE id = ? AND email_id = ?', [id, email], (err, results) => {
        if (err) {
            console.error('Error fetching image:', err);
            return res.status(500).send('Failed to fetch image.');
        }

        if (results.length === 0) {
            return res.status(404).json({ message: 'Image not found.' });
        }

        const image = results[0];
        res.json({
            id: image.id,
            imageName: image.image_name,
            imageUrl: `data:image/jpeg;base64,${image.image_url.toString('base64')}`,
        });
    });
});

// Delete  a single photo and archive it in deleted_images_tb (by email_id)
app.delete('/api/deletephoto/:id', verifyEmail1, (req, res) => {
    const { id } = req.params;
    const { email } = req;

    if (!id) {
        return res.status(400).json({ message: 'Photo ID is required.' });
    }

    db.query('SELECT * FROM images WHERE id = ? AND email_id = ?', [id, email], (selectError, results) => {
        if (selectError) {
            console.error('Error fetching photo details:', selectError);
            return res.status(500).json({ message: 'Failed to fetch photo details.' });
        }

        if (results.length === 0) {
            return res.status(404).json({ message: 'Photo not found.' });
        }

        const photo = results[0];
        const deletedAt = new Date();

        const insertQuery = `
            INSERT INTO deleted_images_tb (id, imageName, imageUrl, email_id, deletedAt) 
            VALUES (?, ?, ?, ?, ?)
        `;
        db.query(
            insertQuery,
            [photo.id, photo.image_name, photo.image_url, email, deletedAt],
            (insertError) => {
                if (insertError) {
                     return res.status(500).json({ message: 'Failed to archive deleted photo.' });
                }

                db.query('DELETE FROM images WHERE id = ? AND email_id = ?', [id, email], (deleteError, deleteResults) => {
                    if (deleteError) {
                         return res.status(500).json({ message: 'Failed to delete photo.' });
                    }

                    if (deleteResults.affectedRows === 0) {
                        return res.status(404).json({ message: 'Photo not found for deletion.' });
                    }

                    res.json({ message: 'Photo deleted and archived successfully.' });
                });
            }
        );
    });
});
https://rameshjatav.github.io/backend_images/
// Fetch deleted images (by email_id)
app.get('/api/images_deleted_all', (req, res) => {
    const { email } = req.query; // Get email from query params

    db.query('SELECT id, imageName, imageUrl, deletedAt, user_id, email_id FROM deleted_images_tb WHERE email_id = ? ORDER BY deletedAt DESC', [email], (err, results) => {
        if (err) {
            res.status(500).send('Failed to fetch images.');
        } else {
            const images = results.map((row) => ({
                id: row.id,
                imageName: row.imageName,
                // Assuming imageUrl contains binary data that needs to be converted to base64
                imageUrl: `data:image/jpeg;base64,${row.imageUrl.toString('base64')}`,
                deletedAt: row.deletedAt,
                user_id: row.user_id,
            }));
            res.json(images);
        }
    });
});

app.delete('/api/recoverphoto/:id', (req, res) => {
    const { id } = req.params;
    const { email } = req.query;  // Get email from query params

    if (!id || !email) {
        return res.status(400).json({ message: 'Photo ID and email are required.' });
    }

    // Fetch the photo from deleted_images_tb by email and id
    db.query('SELECT * FROM deleted_images_tb WHERE id = ? AND email_id = ?', [id, email], (selectError, results) => {
        if (selectError) {
            console.error('Error fetching photo details from archive:', selectError);
            return res.status(500).json({ message: 'Failed to fetch photo details from archive.' });
        }

        if (results.length === 0) {
            return res.status(404).json({ message: 'Photo not found in archive for the provided email.' });
        }

        const photo = results[0];

        // Insert the photo back into the images table
        const insertQuery = `
            INSERT INTO images (id, image_name, image_url, email_id ) 
            VALUES (?, ?, ?, ?)
        `;
        db.query(
            insertQuery,
            [photo.id, photo.imageName, photo.imageUrl, photo.email_id ],
            (insertError) => {
                if (insertError) {
                    console.error('Error recovering photo:', insertError);
                    return res.status(500).json({ message: 'Failed to recover photo.' });
                }

                // Delete the photo from deleted_images_tb
                db.query('DELETE FROM deleted_images_tb WHERE id = ? AND email_id = ?', [id, email], (deleteError, deleteResults) => {
                    if (deleteError) {
                        console.error('Error deleting photo from archive:', deleteError);
                        return res.status(500).json({ message: 'Failed to delete photo from archive.' });
                    }

                    if (deleteResults.affectedRows === 0) {
                        return res.status(404).json({ message: 'Photo not found in archive for deletion.' });
                    }

                    res.json({ message: 'Photo recovered and moved back successfully.' });
                });
            }
        );
    });
});

app.delete('/delete/api/deleted_image/:id', (req, res) => {
    const { id } = req.params;
    const { email } = req.query;  // Get email from query params

    if (!id || !email) {
        return res.status(400).json({ message: 'Photo ID and email are required.' });
    }

    // Delete the photo from deleted_images_tb by email and id
    db.query('DELETE FROM deleted_images_tb WHERE id = ? AND email_id = ?', [id, email], (error, result) => {
        if (error) {
            console.error('Error deleting photo:', error);
            return res.status(500).json({ message: 'Internal Server Error.' });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Photo not found for the provided email.' });
        }

        res.status(200).json({ message: 'Photo deleted successfully.' });
    });
});

app.delete('/delete/All_photos', (req, res) => {
    const { email_id } = req.body; // Get email_id from request body

    if (!email_id) {
        return res.status(400).json({ message: 'Email ID is required.' });
    }

    // Fetch all photos associated with the provided email ID
    db.query('SELECT * FROM images WHERE email_id = ?', [email_id], (error, results) => {
        if (error) {
             return res.status(500).json({ message: 'Failed to fetch images before deletion.' });
        }

        if (results.length === 0) {
            return res.status(200).json({ message: 'No photos to delete for this email.' });
        }

        const deletedAt = new Date(); // Current timestamp
        const deletedPhotos = results.map(photo => [
            photo.id,
            photo.image_name,
            photo.image_url,
            deletedAt,
            photo.email_id,
        ]);

        // Insert all photos into deleted_images_tb
        const insertQuery = `
            INSERT INTO deleted_images_tb (id, imageName, imageUrl, deletedAt, email_id) 
            VALUES ?
        `;
        db.query(insertQuery, [deletedPhotos], (insertError) => {
            if (insertError) {
                 return res.status(500).json({ message: 'Failed to archive deleted photos.' });
            }

            // Delete photos from the images table for the given email ID
            db.query('DELETE FROM images WHERE email_id = ?', [email_id], (deleteError) => {
                if (deleteError) {
                     return res.status(500).json({ message: 'Failed to delete photos from images table.' });
                }

                res.status(200).json({ message: 'All photos deleted and archived successfully for the given email ID.' });
            });
        });
    });
});

// Start Server
const PORT = process.env.DB_PORT;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
