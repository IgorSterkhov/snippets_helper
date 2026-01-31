from PIL import Image, ImageDraw, ImageFont
import os

def create_icon():
    # Create images of different sizes
    sizes = [16, 32, 128, 256, 512, 1024]
    
    for size in sizes:
        # Create a new image with a white background
        image = Image.new('RGB', (size, size), 'white')
        draw = ImageDraw.Draw(image)
        
        # Draw a rounded rectangle
        radius = size // 8
        draw.rounded_rectangle([size//8, size//8, size-size//8, size-size//8], 
                             radius=radius, fill='#0066cc')
        
        # Add text
        font_size = size // 4
        try:
            font = ImageFont.truetype('/System/Library/Fonts/SFNSMono.ttf', font_size)
        except:
            font = ImageFont.load_default()
            
        text = "KH"  # Keyboard Helper
        text_bbox = draw.textbbox((0, 0), text, font=font)
        text_width = text_bbox[2] - text_bbox[0]
        text_height = text_bbox[3] - text_bbox[1]
        
        x = (size - text_width) // 2
        y = (size - text_height) // 2
        draw.text((x, y), text, fill='white', font=font)
        
        # Save the image
        os.makedirs('AppIcon.iconset', exist_ok=True)
        if size <= 32:
            image.save(f'AppIcon.iconset/icon_{size}x{size}.png')
            image.save(f'AppIcon.iconset/icon_{size}x{size}@2x.png')
        else:
            image.save(f'AppIcon.iconset/icon_{size//2}x{size//2}@2x.png')

def create_ico():
    """Create Windows .ico file from generated images."""
    # ICO supports multiple sizes - we'll create them fresh
    sizes = [16, 32, 48, 64, 128, 256]
    images = []

    for size in sizes:
        image = Image.new('RGBA', (size, size), (255, 255, 255, 0))
        draw = ImageDraw.Draw(image)

        radius = size // 8
        draw.rounded_rectangle(
            [size // 8, size // 8, size - size // 8, size - size // 8],
            radius=radius,
            fill='#0066cc'
        )

        font_size = size // 4
        try:
            font = ImageFont.truetype('/System/Library/Fonts/SFNSMono.ttf', font_size)
        except:
            try:
                font = ImageFont.truetype('C:/Windows/Fonts/consola.ttf', font_size)
            except:
                font = ImageFont.load_default()

        text = "KH"
        text_bbox = draw.textbbox((0, 0), text, font=font)
        text_width = text_bbox[2] - text_bbox[0]
        text_height = text_bbox[3] - text_bbox[1]

        x = (size - text_width) // 2
        y = (size - text_height) // 2
        draw.text((x, y), text, fill='white', font=font)

        images.append(image)

    # Save as ICO with all sizes
    images[0].save(
        'AppIcon.ico',
        format='ICO',
        sizes=[(s, s) for s in sizes],
        append_images=images[1:]
    )
    print("Created AppIcon.ico")


if __name__ == '__main__':
    create_icon()
    create_ico() 