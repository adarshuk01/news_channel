const { postImageToInstagram } = require("../services/instagramService");

exports.testInstagramImage = async (req, res) => {
  try {
    const result = await postImageToInstagram(
      "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=1200",
      "Instagram API test 🚀"
    );

    res.json({
      success: true,
      result,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: err.message,
    });
  }
};